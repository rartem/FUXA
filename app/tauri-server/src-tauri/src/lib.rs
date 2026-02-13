use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

struct ServerProcess {
    child: Arc<Mutex<Option<Child>>>,
}

fn dbg(msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("C:\\tmp\\fuxa-debug.log") {
        let _ = writeln!(f, "{}", msg);
    }
}

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn is_running(state: State<ServerProcess>) -> bool {
    let mut guard = state.child.lock().unwrap();
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(Some(_)) => { *guard = None; false }
            Ok(None) => true,
            Err(_) => { *guard = None; false }
        }
    } else {
        false
    }
}

#[tauri::command]
fn start_server(
    app: AppHandle,
    state: State<ServerProcess>,
    server_dir: String,
    port: u16,
    node_exe: String,
) -> Result<u32, String> {
    dbg(&format!("start_server: dir={}, port={}, exe={}", server_dir, port, node_exe));
    {
        let mut guard = state.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            if child.try_wait().ok().flatten().is_none() {
                return Err("Server is already running".into());
            }
        }
    }

    let exe = if node_exe.is_empty() { "node".to_string() } else { node_exe };

    let mut child = Command::new(&exe)
        .arg("main.js")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&server_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            dbg(&format!("spawn error: {}", e));
            format!("Failed to start '{}': {}", exe, e)
        })?;

    let pid = child.id();
    dbg(&format!("spawned pid={}", pid));

    if let Some(stdout) = child.stdout.take() {
        let ah = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let _ = ah.emit("server-stdout", &line);
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let ah = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let _ = ah.emit("server-stderr", &line);
            }
        });
    }

    *state.child.lock().unwrap() = Some(child);

    // Monitor exit in background
    let ah = app.clone();
    let child_arc = Arc::clone(&state.child);
    thread::spawn(move || {
        loop {
            thread::sleep(std::time::Duration::from_millis(500));
            let mut guard = child_arc.lock().unwrap();
            if let Some(ref mut c) = *guard {
                match c.try_wait() {
                    Ok(Some(status)) => {
                        let code = status.code().unwrap_or(-1);
                        let _ = ah.emit("server-exit", code);
                        *guard = None;
                        break;
                    }
                    Ok(None) => {}
                    Err(_) => {
                        let _ = ah.emit("server-exit", -1i32);
                        *guard = None;
                        break;
                    }
                }
            } else {
                break;
            }
            drop(guard); // release lock while sleeping
        }
    });

    Ok(pid)
}

#[tauri::command]
fn stop_server(state: State<ServerProcess>) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();
    if let Some(ref mut child) = *guard {
        child.kill().map_err(|e| format!("Failed to stop: {}", e))?;
        let _ = child.wait();
        *guard = None;
        Ok(())
    } else {
        Err("Server is not running".into())
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(ServerProcess {
            child: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            get_version,
            is_running,
            start_server,
            stop_server,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FUXA Server");
}
