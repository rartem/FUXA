/**
 * 'easydrv': EasyDriver protocol client for PAC controllers.
 * Based on the C++ EasyDriver implementation (PAC_cmmctr).
 * Communicates via TCP/IP with binary framing; responses are Lua strings
 * that set global variables and the tags table.
 * Uses fengari (Lua 5.3 in pure JavaScript) for reliable Lua response parsing.
 */

'use strict';

const net = require('net');
const zlib = require('zlib');
const utils = require('../../utils');
const deviceUtils = require('../device-utils');
const fengari = require('fengari');
const lua = fengari.lua;
const lauxlib = fengari.lauxlib;
const lualib = fengari.lualib;

// ---------------------------------------------------------------------------
// Protocol constants (matching C++ device_communicator enum)
// ---------------------------------------------------------------------------
// Command bytes — first byte of payload data (buf[6] in the frame).
// Values from g_device.h: device_communicator::CMD enum.
const CMD = {
    GET_INFO:        10,   // CMD_GET_INFO_ON_CONNECT — protocol version, PAC name
    GET_DEVICES:     100,  // CMD_GET_DEVICES — device definitions (+ 2-byte request_id)
    GET_STATES:      101,  // CMD_GET_DEVICES_STATES — device states (+ 2-byte request_id)
    EXEC_CMD:        102,  // CMD_EXEC_DEVICE_COMMAND — execute Lua string on PAC
    GET_PAC_ERRORS:  103,  // CMD_GET_PAC_ERRORS
    SET_PAC_ERROR:   104,  // CMD_SET_PAC_ERROR_CMD
    GET_PARAMS:      105,  // CMD_GET_PARAMS
    RESTORE_PARAMS:  106,  // CMD_RESTORE_PARAMS
    GET_PARAMS_CRC:  107,  // CMD_GET_PARAMS_CRC
};

const ERROR_CMD = {
    ACCEPT: 100,
    SUPPRESS: 200,
    UNSET_SUPPRESS: 201
};

const ERROR_STATE = {
    0: 'normal',
    1: 'alarm',
    2: 'return',
    3: 'accept'
};

const ERROR_PROJECT_ID = 1;

const REQ_ID_SIZE = 2; // g_devices_request_id (u_int_2) prepended to GET_DEVICES/GET_STATES responses

const SERVICE_ID        = 1;
const FRAME_SINGLE      = 1;
const FRAME_MARKER      = 0x73; // 's'
const HEADER_SIZE       = 6;    // send header
const RESP_HEADER_SIZE  = 5;    // response header
const MAX_BUFFER_SIZE   = 500 * 1024;
const MAX_ERRORS_COUNT  = 2;

// Response status codes (matching C++ tcp_communicator::COMMANDS)
const AKN_ERR           = 7;   // error acknowledgment
const AKN_DATA          = 8;   // data acknowledgment (unused in PAC code)
const AKN_OK            = 12;  // success acknowledgment

const PAC_ACCEPT        = 'PAC accept';  // handshake string sent by PAC on connect
const CONNECTION_ERROR_GROUP = 'connection';
const CONNECTION_ERROR_PRIORITY = 100;

const PROTO_QLZ         = 102;
const PROTO_NON_UNICODE = 103;
const PROTO_CURRENT     = 104;
const PROTO_UNKNOWN     = 1;

// Lua built-in names to skip when enumerating globals
const LUA_BUILTINS = new Set([
    'assert', 'collectgarbage', 'dofile', 'error', 'getmetatable',
    'ipairs', 'load', 'loadfile', 'next', 'pairs', 'pcall',
    'print', 'rawequal', 'rawget', 'rawlen', 'rawset', 'require',
    'select', 'setmetatable', 'tonumber', 'tostring', 'type',
    'warn', 'xpcall', '_VERSION',
    'coroutine', 'debug', 'io', 'math', 'os', 'package',
    'string', 'table', 'utf8', 'arg',
]);

// ---------------------------------------------------------------------------
// LuaEngine — wraps fengari (pure JS Lua 5.3) for executing PAC Lua responses
// ---------------------------------------------------------------------------
class LuaEngine {
    constructor() {
        this.L = null;
    }

    /**
     * Initialize Lua state — synchronous, no WASM involved.
     */
    init() {
        this.L = lauxlib.luaL_newstate();
        lualib.luaL_openlibs(this.L);
    }

    /**
     * Execute a Lua string in the VM. PAC responses may reference
     * undefined globals (device metatables, etc.) — wrap in pcall
     * to avoid hard errors.
     */
    execute(luaStr) {
        if (!this.L || !luaStr) return;
        // Provide stub __newindex / object constructors so PAC code
        // that calls methods on undefined globals does not crash.
        var safePrefix =
            'if not __stub_mt then\n' +
            '  __stub_mt = { __index = function() return function() end end,\n' +
            '                __newindex = function(t,k,v) rawset(t,k,v) end,\n' +
            '                __call = function() return setmetatable({}, __stub_mt) end }\n' +
            '  setmetatable(_G, { __index = function(t,k)\n' +
            '    if k:sub(1,2) == "__" then\n' +
            '      local obj = setmetatable({}, __stub_mt)\n' +
            '      rawset(t,k,obj)\n' +
            '      return obj\n' +
            '    end\n' +
            '  end })\n' +
            'end\n';
        try {
            lauxlib.luaL_dostring(this.L, fengari.to_luastring(safePrefix + luaStr));
        } catch (e) {
            // Ignore non-critical Lua errors; state may still be partially usable
        }
    }

    /**
     * Read a single global value from the Lua state.
     * Tables are recursively converted to plain JS objects.
     */
    get(name) {
        if (!this.L) return undefined;
        try {
            lua.lua_getglobal(this.L, fengari.to_luastring(name));
            var result = this._readStackValue(-1, 0);
            lua.lua_pop(this.L, 1);
            return result;
        } catch (e) {
            return undefined;
        }
    }

    /**
     * Read a value from the Lua stack at the given index.
     * Depth-limited to prevent infinite recursion on cyclic tables.
     */
    _readStackValue(index, depth) {
        if (depth > 10) return undefined;
        var t = lua.lua_type(this.L, index);
        switch (t) {
            case lua.LUA_TNIL:
                return null;
            case lua.LUA_TBOOLEAN:
                return lua.lua_toboolean(this.L, index) ? true : false;
            case lua.LUA_TNUMBER:
                return lua.lua_tonumber(this.L, index);
            case lua.LUA_TSTRING:
                return fengari.to_jsstring(lua.lua_tostring(this.L, index));
            case lua.LUA_TTABLE:
                return this._readTable(index, depth + 1);
            default:
                return undefined;
        }
    }

    /**
     * Convert a Lua table on the stack to a plain JS object.
     */
    _readTable(index, depth) {
        if (depth > 10) return undefined;
        var result = {};
        var absIdx = lua.lua_absindex(this.L, index);
        lua.lua_pushnil(this.L);
        while (lua.lua_next(this.L, absIdx) !== 0) {
            var key;
            var keyType = lua.lua_type(this.L, -2);
            if (keyType === lua.LUA_TSTRING) {
                key = fengari.to_jsstring(lua.lua_tostring(this.L, -2));
            } else if (keyType === lua.LUA_TNUMBER) {
                key = lua.lua_tonumber(this.L, -2);
            } else {
                lua.lua_pop(this.L, 1);
                continue;
            }
            var value = this._readStackValue(-1, depth);
            if (value !== undefined) {
                result[key] = value;
            }
            lua.lua_pop(this.L, 1);
        }
        return result;
    }

    close() {
        if (this.L) {
            try { lua.lua_close(this.L); } catch (e) {}
            this.L = null;
        }
    }
}

// ---------------------------------------------------------------------------
// Build a Lua set-command string for writing tag values.
// Mirrors the C++ make_lua_str() function.
// Format: __DEVICE:set_cmd("prop", n, value)
// ---------------------------------------------------------------------------
function makeLuaSetCmd(tagAddress, value) {
    if (!tagAddress) return '';
    // Strip 't.' prefix (Lua global table used for browse/read, not for set_cmd)
    var addr = tagAddress.startsWith('t.') ? tagAddress.substring(2) : tagAddress;
    // Parse address: "DEVICE.property[n]" or "DEVICE.property.n" or "DEVICE.property"
    const match = addr.match(/^(.+)\.([A-Za-z_]\w*)(?:\[(\d+)\]|\.(\d+))?$/);
    if (!match) return '';
    const objName = match[1];
    const prop = match[2];
    const n = match[3] || match[4] || '0';
    if (typeof value === 'string') {
        return `__${objName}:set_cmd( "${prop}", ${n}, "${value}" )`;
    }
    return `__${objName}:set_cmd( "${prop}", ${n}, ${value} )`;
}

// ---------------------------------------------------------------------------
// EasyDrv Client — FUXA driver interface
// ---------------------------------------------------------------------------
function EasyDrvClient(_data, _logger, _events, _runtime) {
    var data = JSON.parse(JSON.stringify(_data));
    var logger = _logger;
    var events = _events;
    var runtime = _runtime;

    // Connection state
    var socket = null;
    var connected = false;
    var working = false;
    var overloading = 0;
    var lastStatus = '';
    var lastTimestampValue = null;
    var packetIndex = 0;
    var errRetryCount = 0;
    var protocolVersion = PROTO_UNKNOWN;
    var gotDevices = false;
    var pacInfoReceived = false;
    var connectionFault = false;

    // PAC info (populated by get_PAC_info)
    var pacInfo = { name: '', version: 0, paramsCRC: 0 };
    var deviceErrors = [];
    var deviceErrorsId = 0;
    var commandQueue = Promise.resolve();

    // Receive buffer for TCP stream reassembly
    var recvBuffer = Buffer.alloc(0);

    // Tags cache
    var varsValue = {};
    // Lua state as JS object tree (populated by fengari)
    var luaState = {};
    // LuaEngine instance for parsing
    var luaEngine = null;
    // Raw Lua string from last PAC response
    var lastStatesLua = '';

    // ── Helper: get connection params ──
    var _getConnParams = function () {
        var prop = data.property || {};
        var address = (prop.address || '127.0.0.1').replace(/^IP/i, '');
        var port = parseInt(prop.port) || 10000;
        var timeout = parseInt(prop.timeout) || 1500;
        var pacName = prop.pacName || '';
        return { address, port, timeout, pacName };
    };

    // ── Initialize fengari LuaEngine ──
    var _initLuaEngine = function () {
        if (luaEngine) {
            luaEngine.close();
        }
        luaEngine = new LuaEngine();
        luaEngine.init();
    };

    // ── Execute Lua string in engine ──
    var _executeLua = function (luaStr) {
        if (!luaEngine) {
            _initLuaEngine();
        }
        luaEngine.execute(luaStr);
    };

    // ── Extract 't' table from Lua state into JS object ──
    // Only reads the 't' global. fengari get() returns plain JS objects.
    var _extractLuaState = function () {
        if (!luaEngine) return;
        var t = luaEngine.get('t');
        if (t && typeof t === 'object') {
            luaState = { t: t };
        }
    };

    var _enqueueCommand = function (fnc) {
        var run = commandQueue.then(() => fnc());
        commandQueue = run.catch(() => {});
        return run;
    };

    // ── TCP frame send ──
    var _sendFrame = function (cmdData) {
        return new Promise((resolve, reject) => {
            if (!socket || socket.destroyed) {
                return reject(new Error('socket not connected'));
            }
            packetIndex = (packetIndex + 1) & 0xFF;
            var dataLen = cmdData.length;
            var frame = Buffer.alloc(HEADER_SIZE + dataLen);
            frame[0] = FRAME_MARKER;       // 's'
            frame[1] = SERVICE_ID;         // service ID
            frame[2] = FRAME_SINGLE;       // frame type
            frame[3] = packetIndex;        // packet index
            frame[4] = (dataLen >> 8) & 0xFF;  // length high
            frame[5] = dataLen & 0xFF;         // length low
            cmdData.copy(frame, HEADER_SIZE);

            var params = _getConnParams();
            var timeoutMs = params.timeout;
            var responded = false;

            var onData = (chunk) => {
                recvBuffer = Buffer.concat([recvBuffer, chunk]);
                var result = _tryParseResponse();
                if (result !== null) {
                    responded = true;
                    clearTimeout(timer);
                    socket.removeListener('data', onData);
                    socket.removeListener('error', onError);
                    resolve(result);
                }
            };

            var onError = (err) => {
                if (!responded) {
                    responded = true;
                    clearTimeout(timer);
                    socket.removeListener('data', onData);
                    socket.removeListener('error', onError);
                    reject(err);
                }
            };

            var timer = setTimeout(() => {
                if (!responded) {
                    responded = true;
                    socket.removeListener('data', onData);
                    socket.removeListener('error', onError);
                    reject(new Error('timeout'));
                }
            }, timeoutMs);

            socket.on('data', onData);
            socket.on('error', onError);
            socket.write(frame);
        });
    };

    // ── Parse TCP response frame ──
    // Response format from PAC (tcp_cmctr.cpp):
    //   buf[0] = net_id ('s')        — FRAME_MARKER
    //   buf[1] = status              — AKN_OK(12) or AKN_ERR(7)
    //   buf[2] = pidx                — packet index echoed back
    //   buf[3] = (dataLen >> 8)      — data length high byte
    //   buf[4] = dataLen & 0xFF      — data length low byte
    //   buf[5..] = data              — response payload
    var _tryParseResponse = function () {
        // Skip any non-framed bytes at the start of the buffer
        // (e.g. leftover "PAC accept" text if it arrives late)
        while (recvBuffer.length > 0 && recvBuffer[0] !== FRAME_MARKER) {
            recvBuffer = recvBuffer.slice(1);
        }

        if (recvBuffer.length < RESP_HEADER_SIZE) return null;

        // Check for error status (AKN_ERR = 7)
        // _ErrorAkn sends 6 bytes: header(5) + 1 byte error code
        if (recvBuffer[1] === AKN_ERR) {
            var errDataLen = recvBuffer[3] * 256 + recvBuffer[4]; // typically 1
            var errTotalLen = RESP_HEADER_SIZE + errDataLen;
            if (recvBuffer.length < errTotalLen) return null; // need more data
            var errCode = errDataLen > 0 ? recvBuffer[5] : 0;
            recvBuffer = recvBuffer.slice(errTotalLen);
            return { error: 'PAC error code ' + errCode };
        }

        // Validate packet index
        if (recvBuffer[2] !== packetIndex) {
            logger.warn(`'${data.name}' packet index mismatch: got ${recvBuffer[2]}, expected ${packetIndex}`);
        }

        var answerSize = recvBuffer[3] * 256 + recvBuffer[4];

        // _AknOK: answerSize === 0 is a valid success (no data)
        if (answerSize === 0) {
            recvBuffer = recvBuffer.slice(RESP_HEADER_SIZE);
            return { error: null, data: Buffer.alloc(0) };
        }

        if (answerSize > MAX_BUFFER_SIZE) {
            logger.warn(`'${data.name}' answer too large: ${answerSize}`);
            recvBuffer = Buffer.alloc(0);
            return { error: 'answer too large' };
        }

        var totalNeeded = RESP_HEADER_SIZE + answerSize;
        if (recvBuffer.length < totalNeeded) return null; // need more data

        var answerData = recvBuffer.slice(RESP_HEADER_SIZE, totalNeeded);
        recvBuffer = recvBuffer.slice(totalNeeded);

        // Try decompression based on protocol version
        var decompressed = _tryDecompress(answerData);
        return { error: null, data: decompressed };
    };

    // ── Decompression ──
    var _tryDecompress = function (buf) {
        if (!buf || buf.length === 0) return buf;
        try {
            var result = zlib.inflateSync(buf);
            return result;
        } catch (e) {
            return buf;
        }
    };

    // ── Extract Lua script from decompressed response buffer ──
    // PAC responses may contain null bytes before the actual Lua text.
    // Approach matches query.cs: strip nulls, find Lua script marker.
    var _extractLuaString = function (buf) {
        if (!buf || buf.length === 0) return '';
        var str = buf.toString('utf8');
        // Strip null bytes (query.cs: decompressed.Replace("\u0000", ""))
        str = str.replace(/\0/g, '');
        return str.trim();
    };

    // ── Send command and get buffer response ──
    var _sendCommand = async function (cmdByte, extraData) {
        return _enqueueCommand(async function () {
            var cmdLen = 1 + (extraData ? extraData.length : 0);
            var cmdBuf = Buffer.alloc(cmdLen);
            cmdBuf[0] = cmdByte;
            if (extraData) {
                extraData.copy(cmdBuf, 1);
            }
            recvBuffer = Buffer.alloc(0);
            var response = await _sendFrame(cmdBuf);
            if (response.error) {
                throw new Error(response.error);
            }
            return response.data;
        });
    };

    // ── Get PAC info (protocol version, name) — uses fengari ──
    var _getPACInfo = async function () {
        var answer = await _sendCommand(CMD.GET_INFO);
        var luaStr = _extractLuaString(answer);
        if (luaStr) {
            _executeLua(luaStr);
        }
        // Read individual scalar globals directly (no table iteration)
        pacInfo.version = luaEngine.get('protocol_version') || PROTO_UNKNOWN;
        pacInfo.name = luaEngine.get('PAC_name') || '';
        pacInfo.paramsCRC = luaEngine.get('params_CRC') || 0;
        protocolVersion = pacInfo.version;

        if (protocolVersion !== PROTO_CURRENT &&
            protocolVersion !== PROTO_NON_UNICODE &&
            protocolVersion !== PROTO_QLZ) {
            logger.warn(`'${data.name}' PAC protocol version ${protocolVersion}, expected ${PROTO_CURRENT}`);
        }

        var params = _getConnParams();
        if (params.pacName && pacInfo.name && params.pacName !== pacInfo.name) {
            logger.warn(`'${data.name}' PAC name mismatch: got "${pacInfo.name}", expected "${params.pacName}"`);
        }

        pacInfoReceived = true;
        logger.info(`'${data.name}' PAC info: name="${pacInfo.name}", protocol=${protocolVersion}`, true);
    };

    // ── Get full PAC state (devices + values) — CMD 101 ──
    // Response (after zlib decompression) format from g_device.cpp:
    //   [2 bytes g_devices_request_id (u_int_2 LE)]
    //   [Lua script building 't' table]
    //   [null terminator]
    var _getPACStates = async function () {
        var answer = await _sendCommand(CMD.GET_STATES);
        if (answer.length < REQ_ID_SIZE) return null;
        // Skip 2-byte g_devices_request_id prefix
        var luaStr = _extractLuaString(answer.slice(REQ_ID_SIZE));
        if (luaStr) {
            lastStatesLua = luaStr;
            // Execute Lua on existing engine (t= creates fresh table each time)
            // Engine is initialized once in connect()
            _executeLua(lastStatesLua);
            // Extract only the 't' table — no full globals iteration
            _extractLuaState();
            return luaState;
        }
        return null;
    };

    var _execLuaCommand = async function (cmdByte, cmdStr) {
        if (!socket || socket.destroyed) {
            throw new Error('socket not connected');
        }
        var cmdBytes = Buffer.from(`${cmdStr}\0`, 'utf8');
        var answer = await _sendCommand(cmdByte, cmdBytes);
        if (answer && answer.length > 0 && answer[0] !== 0) {
            throw new Error(`PAC command failed (${answer[0]})`);
        }
        return true;
    };

    var _execCommand = async function (cmdStr) {
        return _execLuaCommand(CMD.EXEC_CMD, cmdStr);
    };

    var _execPACErrorLuaCommand = async function (cmdStr) {
        if (!socket || socket.destroyed) {
            throw new Error('socket not connected');
        }
        await _sendCommand(CMD.SET_PAC_ERROR, Buffer.from(cmdStr, 'utf8'));
        return true;
    };

    var _normalizeErrorsLuaString = function (luaStr) {
        if (!luaStr) {
            return '';
        }
        var normalized = String(luaStr).replace(/\0/g, '').trim();
        var firstAssignment = normalized.search(/alarms\s*\[\s*\d+\s*\]\s*=/);
        if (firstAssignment > 0) {
            normalized = normalized.slice(firstAssignment);
        }
        normalized = normalized.replace(/(\}|\])\s*(alarms\s*\[\s*\d+\s*\]\s*=)/g, '$1\n$2');
        normalized = normalized.replace(/alarms\s*\[\s*\d+\s*\]\s*=\s*\{\s*\}\s*(?=alarms\s*\[\s*\d+\s*\]\s*=)/g, '');
        return normalized.trim();
    };

    var _hasErrorsProjectSnapshot = function (luaStr) {
        var normalized = _normalizeErrorsLuaString(luaStr);
        if (!normalized) {
            return false;
        }
        return new RegExp(`alarms\\s*\\[\\s*(?:${ERROR_PROJECT_ID}|"${ERROR_PROJECT_ID}"|'${ERROR_PROJECT_ID}')\\s*\\]`).test(normalized);
    };

    var _parseErrorsLua = function (luaStr) {
        luaStr = _normalizeErrorsLuaString(luaStr);
        var parser = new LuaEngine();
        parser.init();
        parser.execute('alarms = alarms or {}');
        parser.execute(luaStr);
        var alarms = parser.get('alarms');
        parser.close();

        var alarmsByProject = alarms ? (alarms[ERROR_PROJECT_ID] || alarms[String(ERROR_PROJECT_ID)]) : null;
        if (!alarmsByProject || typeof alarmsByProject !== 'object') {
            return { id: 0, errors: [] };
        }

        var nextErrors = [];
        Object.keys(alarmsByProject).sort(function (a, b) {
            if (a === 'id') return 1;
            if (b === 'id') return -1;
            return Number(a) - Number(b);
        }).forEach(function (key) {
            if (key === 'id') {
                return;
            }
            var item = alarmsByProject[key];
            if (!item || typeof item !== 'object') {
                return;
            }
            var objectType = Number(item.id_type);
            var objectNumber = Number(item.id_n);
            var objectAlarmNumber = Number(item.id_object_alarm_number);
            var state = Number(item.state);
            var priority = Number(item.priority);
            var type = Number(item.type);
            nextErrors.push({
                id: `${data.id}:${objectType}:${objectNumber}:${objectAlarmNumber}`,
                deviceId: data.id,
                deviceName: data.name,
                description: item.description || '',
                priority: Number.isFinite(priority) ? priority : 0,
                state: Number.isFinite(state) ? state : 0,
                stateText: ERROR_STATE[state] || `${state}`,
                type: Number.isFinite(type) ? type : 0,
                group: item.group || '',
                suppress: Boolean(item.suppress),
                objectType: Number.isFinite(objectType) ? objectType : 0,
                objectNumber: Number.isFinite(objectNumber) ? objectNumber : 0,
                objectAlarmNumber: Number.isFinite(objectAlarmNumber) ? objectAlarmNumber : 0
            });
        });

        return {
            id: Number(alarmsByProject.id) || 0,
            errors: nextErrors
        };
    };

    var _getPACErrors = async function () {
        var answer = await _sendCommand(CMD.GET_PAC_ERRORS, Buffer.from([ERROR_PROJECT_ID]));
        var luaStr = _extractLuaString(answer);
        if (!luaStr) {
            return deviceErrors;
        }
        if (!_hasErrorsProjectSnapshot(luaStr)) {
            logger.warn(`'${data.name}' GET_PAC_ERRORS returned no project snapshot, keeping last known errors`);
            return deviceErrors;
        }
        var parsed;
        try {
            parsed = _parseErrorsLua(luaStr);
        } catch (error) {
            logger.warn(`'${data.name}' GET_PAC_ERRORS parse warning: ${error.message || error}`);
            return deviceErrors;
        }
        deviceErrors = Array.isArray(parsed.errors) ? parsed.errors : [];
        deviceErrorsId = Number.isFinite(parsed.id) ? parsed.id : 0;
        return deviceErrors;
    };

    var _getConnectionError = function () {
        return {
            id: `${data.id}:connection`,
            deviceId: data.id,
            deviceName: data.name,
            description: `${data.name} connection error`,
            priority: CONNECTION_ERROR_PRIORITY,
            state: 1,
            stateText: ERROR_STATE[1],
            type: 0,
            group: CONNECTION_ERROR_GROUP,
            suppress: true,
            objectType: 0,
            objectNumber: 0,
            objectAlarmNumber: 0
        };
    };

    var _hasConnectionError = function () {
        return connectionFault && !connected;
    };

    var _getVisibleErrors = function () {
        var errors = deviceErrors.slice();
        if (_hasConnectionError()) {
            errors.push(_getConnectionError());
        }
        return errors;
    };

    var _normalizeErrorCommand = function (command) {
        if (typeof command === 'number' && Number.isFinite(command)) {
            return command;
        }
        if (typeof command !== 'string') {
            return NaN;
        }
        var normalized = command.trim().toLowerCase();
        if (normalized === 'accept' || normalized === 'ack' || normalized === 'acknowledge') {
            return ERROR_CMD.ACCEPT;
        }
        if (normalized === 'suppress') {
            return ERROR_CMD.SUPPRESS;
        }
        if (normalized === 'unset_suppress' || normalized === 'unsuppress' || normalized === 'clear_suppress') {
            return ERROR_CMD.UNSET_SUPPRESS;
        }
        var numeric = Number(normalized);
        return Number.isFinite(numeric) ? numeric : NaN;
    };

    var _buildErrorLuaCommands = function (cmd, objectType, objectNumber, objectAlarmNumber) {
        var args = `${cmd}, ${objectType}, ${objectNumber}, ${objectAlarmNumber}`;
        return [
            `errors_manager:get_instance():set_cmd( ${args} )`,
            `__G_ERRORS_MANAGER:set_cmd( ${args} )`,
            `G_ERRORS_MANAGER:set_cmd( ${args} )`,
            `__dev_errors_manager:set_cmd( ${args} )`,
            `dev_errors_manager:set_cmd( ${args} )`
        ];
    };

    var _setPACErrorCommand = async function (params) {
        var source = params && (params.error || params.alarm) ? (params.error || params.alarm) : params;
        var command = _normalizeErrorCommand(params ? params.command : undefined);
        var objectType = Number(source ? source.objectType : undefined);
        var objectNumber = Number(source ? source.objectNumber : undefined);
        var objectAlarmNumber = Number(source ? source.objectAlarmNumber : undefined);

        if (!Number.isFinite(command) ||
            !Number.isFinite(objectType) ||
            !Number.isFinite(objectNumber) ||
            !Number.isFinite(objectAlarmNumber)) {
            throw new Error('invalid error command parameters');
        }

        var candidates = _buildErrorLuaCommands(command, objectType, objectNumber, objectAlarmNumber);
        var lastError = null;

        for (var i = 0; i < candidates.length; i++) {
            try {
                await _execPACErrorLuaCommand(candidates[i]);
                await _getPACErrors();
                return true;
            } catch (err) {
                lastError = err;
            }
        }

        throw lastError || new Error('unable to execute PAC error command');
    };

    // ── Resolve tag value from Lua state (dotted path) ──
    var _resolveTagValue = function (tag) {
        var addr = tag.address || tag.name || '';
        // Direct top-level key
        if (luaState[addr] !== undefined && typeof luaState[addr] !== 'object') {
            return luaState[addr];
        }
        // Dotted path: "V1.ST" -> luaState.V1.ST
        if (addr.indexOf('.') > 0) {
            var parts = addr.split('.');
            var val = luaState;
            for (var i = 0; i < parts.length; i++) {
                if (val && typeof val === 'object' && val[parts[i]] !== undefined) {
                    val = val[parts[i]];
                } else {
                    return undefined;
                }
            }
            return (typeof val !== 'object') ? val : undefined;
        }
        // Bracket path: "tags[1]" or "tags.1"
        if (luaState.tags && luaState.tags[addr] !== undefined) {
            return luaState.tags[addr];
        }
        return undefined;
    };

    // ── Build browse tree nodes from luaState ──
    // Returns nodes like OPC-UA: { id, name, class }
    // class must be NUMERIC to match client NodeType enum:
    //   NodeType.Object = 1   (expandable folder)
    //   NodeType.Variable = 2 (selectable tag with checkbox)
    var NODE_CLASS_OBJECT   = 1;
    var NODE_CLASS_VARIABLE = 2;

    var _buildBrowseNodes = function (parentId) {
        var nodes = [];
        var obj;
        if (!parentId) {
            // Root level: enumerate top-level luaState keys
            obj = luaState;
        } else {
            // Navigate to the parent in luaState
            var parts = parentId.split('.');
            obj = luaState;
            for (var i = 0; i < parts.length; i++) {
                if (obj && typeof obj === 'object' && obj[parts[i]] !== undefined) {
                    obj = obj[parts[i]];
                } else {
                    return nodes;
                }
            }
        }
        if (!obj || typeof obj !== 'object') return nodes;

        var keys = Object.keys(obj);
        for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            var val = obj[key];
            var nodeId = parentId ? (parentId + '.' + key) : key;
            if (val !== null && val !== undefined && typeof val === 'object') {
                // Table -> Object node (expandable folder)
                nodes.push({
                    id: nodeId,
                    name: key,
                    class: NODE_CLASS_OBJECT
                });
            } else if (val !== undefined && typeof val !== 'function') {
                // Primitive -> Variable node (selectable tag with checkbox)
                var valType = typeof val;
                nodes.push({
                    id: nodeId,
                    name: key,
                    class: NODE_CLASS_VARIABLE,
                    type: valType === 'number' ? 'number' : (valType === 'boolean' ? 'boolean' : 'string')
                });
            }
        }
        return nodes;
    };

    // =====================================================================
    // FUXA Driver Interface
    // =====================================================================

    this.init = function (_type) {
        // No subtypes for EasyDrv
    };

    /**
     * Connect to PAC controller
     */
    this.connect = function () {
        return new Promise(async (resolve, reject) => {
            if (!_checkWorking(true)) return reject(new Error('busy'));
            try {
                var params = _getConnParams();
                logger.info(`'${data.name}' try to connect ${params.address}:${params.port}`, true);

                // Initialize fengari Lua engine (synchronous, pure JS)
                _initLuaEngine();

                // TCP connect
                socket = new net.Socket();
                socket.setTimeout(params.timeout);

                await new Promise((res, rej) => {
                    var connectTimeout = setTimeout(() => {
                        socket.destroy();
                        rej(new Error('connection timeout'));
                    }, params.timeout);

                    socket.connect(params.port, params.address, () => {
                        clearTimeout(connectTimeout);
                        res();
                    });
                    socket.once('error', (err) => {
                        clearTimeout(connectTimeout);
                        rej(err);
                    });
                });

                // Wait for "PAC accept" handshake from controller
                // PAC sends "PAC accept" (10 bytes plain text) immediately
                // after accepting the TCP connection (w_tcp_cmctr.cpp line 400-401)
                await new Promise((res, rej) => {
                    var handshakeTimeout = setTimeout(() => {
                        // Remove listener to prevent race condition with
                        // _sendFrame's on('data') listener later
                        socket.removeListener('data', onHandshake);
                        logger.warn(`'${data.name}' no "PAC accept" received within ${params.timeout}ms, proceeding anyway`);
                        res();
                    }, params.timeout);

                    var handshakeBuffer = Buffer.alloc(0);
                    var onHandshake = (chunk) => {
                        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
                        var str = handshakeBuffer.toString('utf8');
                        if (str.indexOf(PAC_ACCEPT) >= 0) {
                            clearTimeout(handshakeTimeout);
                            socket.removeListener('data', onHandshake);
                            logger.info(`'${data.name}' received "${PAC_ACCEPT}"`, true);
                            res();
                        }
                    };
                    socket.on('data', onHandshake);
                });

                // Install persistent error handler for socket lifecycle
                socket.on('error', (err) => {
                    logger.error(`'${data.name}' socket error: ${err.message}`);
                });

                connected = true;
                connectionFault = false;
                errRetryCount = 0;
                recvBuffer = Buffer.alloc(0);

                // Get PAC info (protocol version, name)
                try {
                    await _getPACInfo();
                } catch (err) {
                    logger.warn(`'${data.name}' get PAC info warning: ${err.message}`);
                }

                // Get initial PAC state (devices + values via CMD 101)
                try {
                    await _getPACStates();
                    gotDevices = true;
                } catch (err) {
                    logger.warn(`'${data.name}' get PAC state warning: ${err.message}`);
                }

                try {
                    await _getPACErrors();
                } catch (err) {
                    logger.warn(`'${data.name}' get PAC errors warning: ${err.message}`);
                }

                _emitStatus('connect-ok');
                logger.info(`'${data.name}' connected!`, true);
                _checkWorking(false);
                resolve();
            } catch (err) {
                connected = false;
                connectionFault = true;
                _emitStatus('connect-error');
                _clearVarsValue();
                _checkWorking(false);
                if (socket) {
                    try { socket.removeAllListeners(); socket.destroy(); } catch (e) {}
                    socket = null;
                }
                logger.error(`'${data.name}' connect failed! ${err}`);
                reject(err);
            }
        });
    };

    /**
     * Disconnect from PAC controller
     */
    this.disconnect = function () {
        return new Promise(async (resolve) => {
            try {
                _checkWorking(false);
                if (socket) {
                    socket.removeAllListeners();
                    try { socket.destroy(); } catch (e) {}
                }
                if (luaEngine) {
                    luaEngine.close();
                    luaEngine = null;
                }
            } catch (e) {
                logger.error(`'${data.name}' disconnect failure! ${e}`);
            } finally {
                socket = null;
                connected = false;
                pacInfoReceived = false;
                gotDevices = false;
                errRetryCount = 0;
                luaState = {};
                if (!connectionFault) {
                    deviceErrors = [];
                    deviceErrorsId = 0;
                }
                commandQueue = Promise.resolve();
                _emitStatus('connect-off');
                _clearVarsValue();
                resolve(true);
            }
        });
    };

    /**
     * Polling: read all tag values from PAC (uses fengari)
     */
    this.polling = async function () {
        if (!_checkWorking(true)) return;
        try {
            if (!socket || !connected) {
                _checkWorking(false);
                return;
            }

            var state = await _getPACStates();
            if (!state) {
                _checkWorking(false);
                return;
            }

            var timestamp = Date.now();
            var changed = {};

            for (var id in data.tags) {
                var tag = data.tags[id];
                try {
                    var rawValue = _resolveTagValue(tag);
                    if (rawValue === undefined) continue;

                    var value = await deviceUtils.tagValueCompose(
                        rawValue,
                        varsValue[id] ? varsValue[id].value : null,
                        tag,
                        runtime
                    );

                    var tagChanged = !varsValue[id] || varsValue[id].value !== value;

                    varsValue[id] = {
                        id: id,
                        value: value,
                        rawValue: rawValue,
                        type: tag.type,
                        changed: tagChanged,
                        timestamp: timestamp,
                        daq: tag.daq
                    };

                    if (this.addDaq && deviceUtils.tagDaqToSave(varsValue[id], timestamp)) {
                        changed[id] = varsValue[id];
                    }
                    varsValue[id].changed = false;
                } catch (err) {
                    logger.error(`'${data.name}' read tag ${tag.name} error: ${err}`);
                }
            }

            lastTimestampValue = timestamp;
            errRetryCount = 0;
            _emitValues(varsValue);

            if (this.addDaq && !utils.isEmptyObject(changed)) {
                this.addDaq(changed, data.name, data.id);
            }

            try {
                await _getPACErrors();
            } catch (err) {
                logger.warn(`'${data.name}' polling errors warning: ${err.message}`);
            }

            if (lastStatus !== 'connect-ok') {
                _emitStatus('connect-ok');
            }
        } catch (err) {
            errRetryCount++;
            if (errRetryCount >= MAX_ERRORS_COUNT) {
                connected = false;
                connectionFault = true;
                _emitStatus('connect-error');
            }
            logger.error(`'${data.name}' polling error: ${err}`);
        } finally {
            _checkWorking(false);
        }
    };

    /**
     * Load tags configuration
     */
    this.load = function (_data) {
        data = JSON.parse(JSON.stringify(_data));
        varsValue = {};
        var count = Object.keys(data.tags || {}).length;
        logger.info(`'${data.name}' data loaded (${count})`, true);
    };

    /**
     * Return all current tag values
     */
    this.getValues = function () {
        return varsValue;
    };

    /**
     * Return single tag value with timestamp
     */
    this.getValue = function (id) {
        if (varsValue[id]) {
            return { id: id, value: varsValue[id].value, ts: lastTimestampValue };
        }
        return null;
    };

    /**
     * Return connection status
     */
    this.getStatus = function () {
        return lastStatus;
    };

    this.getErrors = function (refresh) {
        if (refresh !== false && socket && connected) {
            return _getPACErrors().then(() => _getVisibleErrors());
        }
        return _getVisibleErrors();
    };

    this.setErrorCommand = async function (params) {
        if (!socket || !connected) {
            return false;
        }
        await _setPACErrorCommand(params);
        return true;
    };

    /**
     * Return tag property for frontend
     */
    this.getTagProperty = function (id) {
        if (data.tags && data.tags[id]) {
            var t = data.tags[id];
            return { id: id, name: t.name, type: t.type, format: t.format };
        }
        return null;
    };

    /**
     * Write tag value to PAC
     */
    this.setValue = async function (id, value) {
        if (!socket || !connected) return false;
        try {
            var tag = data.tags[id];
            if (!tag) return false;

            var raw = await deviceUtils.tagRawCalculator(value, tag, runtime);
            var fullAddr = tag.address || tag.name || '';
            var addr = fullAddr.startsWith('t.') ? fullAddr.substring(2) : fullAddr;
            var luaCmd = makeLuaSetCmd(fullAddr, raw);
            if (luaCmd) {
                await _execCommand(luaCmd);
                logger.info(`'${data.name}' setValue(${tag.name}, ${raw})`, true, true);
                return true;
            } else {
                var luaSafeAddr = addr.replace(/\.(?=\d)/g, function(m, offset) {
                var rest = addr.slice(offset + 1);
                var numMatch = rest.match(/^(\d+)/);
                return '["' + numMatch[1] + '"].';
            }).replace(/\]\.$/, ']');
            var cmdStr = `${luaSafeAddr} = ${typeof raw === 'string' ? '"' + raw + '"' : raw}`;
                await _execCommand(cmdStr);
                return true;
            }
        } catch (err) {
            logger.error(`'${data.name}' setValue error: ${err}`);
            return false;
        }
    };

    /**
     * Return if device is connected
     */
    this.isConnected = function () {
        return connected && socket && !socket.destroyed;
    };

    /**
     * Browse PAC tags — hierarchical tree like OPC-UA.
     * node = null  → root (top-level globals)
     * node = { id } → children of that node
     */
    this.browse = function (node, callback) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!socket || !connected) {
                    return resolve([]);
                }

                // Ensure we have state data for browsing
                if (!gotDevices || !luaState || !luaState.t) {
                    await _getPACStates();
                    gotDevices = true;
                }

                var parentId = (node && node.id) ? node.id : null;
                var nodes = _buildBrowseNodes(parentId);
                resolve(nodes);
            } catch (err) {
                logger.error(`'${data.name}' browse error: ${err}`);
                reject(err);
            }
        });
    };

    /**
     * Bind DAQ store function
     */
    this.bindAddDaq = function (fnc) {
        this.addDaq = fnc;
    };
    this.addDaq = null;

    /**
     * Bind security property accessor
     */
    this.bindGetProperty = function (fnc) {
        this.getProperty = fnc;
    };
    this.getProperty = null;

    /**
     * Return timestamp of last successful read
     */
    this.lastReadTimestamp = () => lastTimestampValue;

    /**
     * Return DAQ settings for tag
     */
    this.getTagDaqSettings = (tagId) => {
        return data.tags && data.tags[tagId] ? data.tags[tagId].daq : null;
    };

    /**
     * Set DAQ settings for tag
     */
    this.setTagDaqSettings = (tagId, settings) => {
        if (data.tags && data.tags[tagId]) {
            utils.mergeObjectsValues(data.tags[tagId].daq, settings);
        }
    };

    // ── Internal helpers ──

    var _emitValues = function (values) {
        events.emit('device-value:changed', { id: data.id, values: values });
    };

    var _emitStatus = function (status) {
        lastStatus = status;
        events.emit('device-status:changed', { id: data.id, status: status });
    };

    var _clearVarsValue = function () {
        for (var id in varsValue) {
            varsValue[id].value = null;
        }
        _emitValues(varsValue);
    };

    var _checkWorking = function (flag) {
        if (flag && working) {
            if (++overloading >= 3) {
                _emitStatus('connect-busy');
                overloading = 0;
            }
            logger.warn(`'${data.name}' working overload! ${overloading}`);
            return false;
        }
        working = flag;
        if (!flag) overloading = 0;
        return true;
    };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------
module.exports = {
    init: function (settings) { },
    create: function (data, logger, events, manager, runtime) {
        return new EasyDrvClient(data, logger, events, runtime);
    }
};
