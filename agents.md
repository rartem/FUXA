# FUXA — Архитектура проекта

FUXA — веб-приложение для визуализации технологических процессов (SCADA/HMI/Dashboard).  
Стек: **Node.js + Express + Socket.IO** (сервер), **Angular 17 + Angular Material** (клиент).  
Порт по умолчанию: **1881**.

---

## Общая структура

```
FUXA/
├── server/          # Серверная часть (Node.js)
├── client/          # Клиентская часть (Angular)
├── app/             # Electron-обёртка для десктопа
├── odbc/            # Скрипты установки ODBC-драйверов
├── node-red/        # Ресурсы интеграции с Node-RED
├── Dockerfile       # Сборка Docker-образа
└── compose.yml      # Docker Compose конфигурация
```

---

## Серверная часть (`server/`)

### Точка входа

- **`main.js`** — главный файл. Парсит CLI-аргументы (`--port`, `--userDir`), загружает настройки из `_appdata/settings.js`, создаёт HTTP/HTTPS-сервер и Socket.IO, настраивает Express-маршруты для статики, инициализирует FUXA через `fuxa.js`, монтирует Swagger UI и Node-RED (опционально).
- **`fuxa.js`** — фасад. Связывает `runtime` и `api`: вызывает `runtime.init()` и `api.init()`, экспортирует `start()`, `stop()`, `httpApi`.
- **`settings.default.js`** — настройки по умолчанию (порт, язык, DAQ, CORS, heartbeat, логирование и т.д.).
- **`paths.js`** — утилиты для определения путей.
- **`envParams.js`** — чтение переменных окружения.

### Runtime (`server/runtime/`)

Ядро серверной логики. Управляет устройствами, проектом, тревогами, скриптами и WebSocket-коммуникацией с фронтендом.

- **`runtime/index.js`** — центральный модуль. Инициализирует все подсистемы, управляет Socket.IO-подключениями (авторизация по JWT), обрабатывает все WebSocket-события от клиентов (`device-status`, `device-values`, `device-browse`, `daq-query`, `alarms-status` и др.), транслирует изменения значений устройств на все фронтенд-клиенты. Экспортирует доступ ко всем менеджерам.
- **`runtime/events.js`** — определение всех типов Socket.IO-событий (`IoEventTypes`): `device-status`, `device-values`, `device-browse`, `daq-query`, `daq-result`, `alarms-status`, `heartbeat`, `scheduler:updated` и др.
- **`runtime/logger.js`** — логирование (на базе Winston).
- **`runtime/utils.js`** — общие утилиты (проверка типов, сетевые интерфейсы, deep merge и т.д.).

#### Устройства (`runtime/devices/`)

Менеджер устройств. Каждый протокол — отдельная подпапка:

| Папка | Протокол/Тип |
|-------|-------------|
| `modbus/` | Modbus RTU/TCP |
| `s7/` | Siemens S7 Protocol (node-snap7) |
| `opcua/` | OPC-UA |
| `bacnet/` | BACnet IP |
| `mqtt/` | MQTT |
| `ethernetip/` | Ethernet/IP (Allen Bradley) |
| `odbc/` | ODBC (внешние БД) |
| `adsclient/` | Beckhoff ADS |
| `gpio/` | GPIO (Raspberry Pi) |
| `webcam/` | WebCam |
| `melsec/` | Mitsubishi MELSEC |
| `redis/` | Redis |
| `easydrv/` | EasyDrv (PAC controllers via TCP/Lua) |
| `httprequest/` | HTTP/WebAPI запросы |
| `fuxaserver/` | Внутренний сервер (системные теги) |
| `template/` | Шаблон для создания новых драйверов |

- **`devices/index.js`** — менеджер: загрузка, старт, остановка, обновление всех устройств. Хранит `activeDevices` и `sharedDevices`.
- **`devices/device.js`** — базовый класс `Device`: общая логика polling, чтения/записи тегов, подключение конкретного драйвера по типу устройства.
- **`devices/device-utils.js`** — вспомогательные функции для работы с тегами и значениями.

#### Проект (`runtime/project/`)

- **`project/index.js`** — управление проектом: загрузка/сохранение, CRUD для устройств, видов (views), тревог, уведомлений, скриптов, графиков, отчётов, карт. Определяет `ProjectDataCmdType` (SetDevice, DelDevice, SetAlarm, SetScript и т.д.).
- **`project/prjstorage.js`** — хранение проекта на диске (JSON-файлы в `_appdata`).

#### Тревоги (`runtime/alarms/`)

- **`alarms/index.js`** — менеджер тревог: проверка условий (HIGH-HIGH, HIGH, LOW, INFO), изменение статусов, история.
- **`alarms/alarmstorage.js`** — хранение истории тревог в SQLite.

#### Уведомления (`runtime/notificator/`)

- **`notificator/index.js`** — менеджер уведомлений: отправка email (через Nodemailer), управление подписками на события тревог.
- **`notificator/notifystorage.js`** — хранение настроек уведомлений.

#### Скрипты (`runtime/scripts/`)

- **`scripts/index.js`** — менеджер серверных скриптов: выполнение пользовательских JS-скриптов по расписанию или по событиям, доступ к тегам и устройствам из скриптов.
- **`scripts/msm.js`** — Micro State Machine для скриптовых автоматов.

#### Хранилище DAQ (`runtime/storage/`)

Сбор и хранение исторических данных тегов (Data Acquisition).

- **`daqstorage.js`** — абстракция хранилища DAQ.
- **`calculator.js`** — вычисления агрегатов.
- **`sqlite/`** — реализация хранения в SQLite.
- **`influxdb/`** — реализация хранения в InfluxDB.
- **`tdengine/`** — реализация хранения в TDengine.

#### Планировщик (`runtime/scheduler/`)

- **`scheduler-service.js`** — сервис планировщика: управление расписаниями для тегов (установка значений по времени).
- **`scheduler-storage.js`** — хранение расписаний в SQLite.

#### Задачи / Отчёты (`runtime/jobs/`)

- **`jobs/index.js`** — менеджер фоновых задач.
- **`jobs/report.js`** — генерация PDF-отчётов (pdfmake).
- **`jobs/cleaner.js`** — очистка устаревших данных.

#### Пользователи и API-ключи (`runtime/users/`, `runtime/apikeys/`)

- **`users/index.js`** — управление пользователями (CRUD, кэш).
- **`users/usrstorage.js`** — хранение пользователей в SQLite (bcryptjs для паролей).
- **`apikeys/`** — управление API-ключами для внешнего доступа.

#### Плагины (`runtime/plugins/`)

- **`plugins/index.js`** — менеджер плагинов: динамическая установка npm-пакетов через `live-plugin-manager`.

### REST API (`server/api/`)

Express-роутер с JWT-аутентификацией и rate limiting.

- **`api/index.js`** — инициализация всех API-модулей, эндпоинты `/api/version`, `/api/settings`, `/api/heartbeat`.
- **`api/jwt-helper.js`** — генерация/верификация JWT-токенов, управление ролями.
- **`api/path-helper.js`** — утилиты путей API.

| Модуль API | Назначение |
|-----------|-----------|
| `api/projects/` | CRUD проекта, импорт/экспорт |
| `api/auth/` | Логин, выдача токенов |
| `api/users/` | Управление пользователями |
| `api/apikeys/` | CRUD API-ключей |
| `api/alarms/` | Запрос истории тревог |
| `api/daq/` | Запрос исторических данных тегов |
| `api/diagnose/` | Диагностика сервера |
| `api/plugins/` | Управление плагинами |
| `api/scripts/` | Управление скриптами |
| `api/resources/` | Загрузка/управление ресурсами (изображения, файлы) |
| `api/scheduler/` | CRUD расписаний |
| `api/command/` | Отправка команд на устройства |
| `api/reports/` | Генерация и скачивание отчётов |

### Интеграции (`server/integrations/`)

- **`node-red/`** — встраивание Node-RED в FUXA-сервер (монтируется как middleware в Express при `nodeRedEnabled: true`).

### Дополнительные каталоги сервера

| Каталог | Назначение |
|---------|-----------|
| `_appdata/` | Рабочие файлы проекта и настроек (создаётся при запуске) |
| `_db/` | БД SQLite (пользователи, DAQ, тревоги, расписания) |
| `_logs/` | Логи сервера и API |
| `_images/` | Пользовательские изображения (SVG, PNG) |
| `_widgets/` | Пользовательские SVG-виджеты |
| `_reports/` | Сгенерированные отчёты |
| `_webcam_snapshots/` | Снимки с веб-камер |
| `dist/` | Скомпилированная клиентская часть (для продакшена) |
| `docs/` | OpenAPI (Swagger) спецификация |
| `test/` | Серверные тесты (Mocha + Chai + Sinon) |

---

## Клиентская часть (`client/`)

SPA на **Angular 17** с **Angular Material**, собирается Angular CLI.

### Точка входа

- **`src/main.ts`** — бутстрап Angular-приложения.
- **`src/index.html`** — HTML-шаблон.
- **`src/app/app.module.ts`** — корневой NgModule: импорт всех модулей, объявление всех компонентов и сервисов.
- **`src/app/app.routing.ts`** — маршруты приложения.
- **`src/app/app.component.ts`** — корневой компонент.
- **`src/app/auth.guard.ts`** — AuthGuard для защиты маршрутов (проверка JWT).

### Маршруты

| Путь | Компонент | Защита | Описание |
|------|----------|--------|----------|
| `/`, `/home`, `/home/:viewName` | `HomeComponent` | — | Главная (runtime-просмотр видов) |
| `/editor` | `EditorComponent` | AuthGuard | Редактор видов (SVG, drag-n-drop) |
| `/lab` | `LabComponent` | AuthGuard | Лаборатория/тестирование |
| `/device` | `DeviceComponent` | AuthGuard | Настройка устройств и тегов |
| `/users` | `UsersComponent` | AuthGuard | Управление пользователями |
| `/userRoles` | `UsersRolesComponent` | AuthGuard | Управление ролями |
| `/alarms` | `AlarmViewComponent` | AuthGuard | Просмотр активных тревог |
| `/messages` | `AlarmListComponent` | AuthGuard | Настройка тревог |
| `/notifications` | `NotificationListComponent` | AuthGuard | Настройка уведомлений |
| `/scripts` | `ScriptListComponent` | AuthGuard | Серверные скрипты |
| `/reports` | `ReportListComponent` | AuthGuard | Отчёты |
| `/language` | `LanguageTextListComponent` | AuthGuard | Мультиязычность |
| `/logs`, `/events` | `LogsViewComponent` | AuthGuard | Просмотр логов |
| `/view` | `ViewComponent` | — | Публичный вид (без авторизации) |
| `/mapsLocations` | `MapsLocationListComponent` | AuthGuard | Геокарты и локации |
| `/flows` | `NodeRedFlowsComponent` | AuthGuard | Node-RED потоки |
| `/apikeys` | `ApiKeysListComponent` | AuthGuard | API-ключи |

### Сервисы (`_services/`)

| Сервис | Назначение |
|--------|-----------|
| `hmi.service.ts` | **Центральный сервис.** Управляет Socket.IO-подключением к серверу, принимает значения тегов, статусы устройств, результаты DAQ, тревоги. Эмитит события Angular через `EventEmitter`. |
| `project.service.ts` | Работа с проектом: загрузка/сохранение видов, устройств, тегов, тревог, уведомлений, скриптов, графиков. HTTP-запросы к REST API. |
| `auth.service.ts` | Аутентификация: логин, хранение токена, текущий пользователь. |
| `settings.service.ts` | Настройки приложения: загрузка/сохранение серверных настроек. |
| `user.service.ts` | CRUD пользователей через API. |
| `script.service.ts` | Управление скриптами: CRUD, запуск, консоль. |
| `plugin.service.ts` | Установка/удаление плагинов. |
| `diagnose.service.ts` | Диагностика сервера. |
| `resources.service.ts` | Загрузка изображений и файлов. |
| `reports.service.ts` | Работа с отчётами. |
| `command.service.ts` | Отправка команд. |
| `heartbeat.service.ts` | Проверка состояния подключения и обновление токена. |
| `language.service.ts` | Мультиязычность (ngx-translate). |
| `apikeys.service.ts` | Управление API-ключами. |
| `data-converter.service.ts` | Конвертация данных. |
| `app.service.ts` | Глобальное состояние приложения. |
| `toast-notifier.service.ts` | Toast-уведомления (ngx-toastr). |
| `my-file.service.ts` | Работа с файлами. |
| `theme.service.ts` | Управление темой оформления. |

#### Подсервисы коммуникации (`_services/rcgi/`)

| Сервис | Назначение |
|--------|-----------|
| `reswebapi.service.ts` | HTTP-обёртка для REST API (production) |
| `resdemo.service.ts` | Мок-данные для демо-режима |
| `resclient.service.ts` | Клиентский режим (без сервера) |
| `rcgi.service.ts` | Фабрика: выбирает нужный сервис в зависимости от окружения |

### Модели (`_models/`)

| Модель | Описание |
|--------|----------|
| `device.ts` | Устройство, тег (`Tag`), типы устройств (`DeviceType`), типы тегов |
| `hmi.ts` | HMI-модель: виды (`View`), переменные (`Variable`), настройки гейджей (`GaugeSettings`), DAQ-запросы |
| `alarm.ts` | Тревоги: типы, приоритеты, фильтры |
| `project.ts` | Проект: структура, метаданные |
| `script.ts` | Скрипты: параметры, режимы, расписание |
| `settings.ts` | Настройки приложения |
| `user.ts` | Пользователь, группы, роли |
| `chart.ts` | Конфигурация графиков |
| `graph.ts` | Конфигурация диаграмм |
| `report.ts` | Отчёты |
| `notification.ts` | Уведомления |
| `plugin.ts` | Плагины |
| `resources.ts` | Ресурсы (изображения) |
| `maps.ts` | Геокарты |
| `language.ts` | Языковые ресурсы |

### Редактор (`editor/`)

Главный компонент для инженерного проектирования HMI-экранов.

- **`editor.component.ts`** (~65 000 строк) — ядро редактора: drag-n-drop SVG-элементов, привязка тегов к гейджам, работа с видами (views), панелями, графиками, картами.
- **`app-settings/`** — диалог настроек приложения.
- **`chart-config/`** — конфигурация графиков (Chart.js / uPlot).
- **`graph-config/`** — конфигурация диаграмм (bar, pie).
- **`card-config/`** — конфигурация карточек (gridster).
- **`layout-property/`** — настройка лейаута (боковое меню, шапка).
- **`view-property/`** — свойства вида.
- **`svg-selector/`** — выбор SVG-элементов из библиотеки.
- **`plugins/`** — управление плагинами из редактора.
- **`setup/`** — начальная настройка.
- **`tags-ids-config/`** — массовая конфигурация привязки тегов.

### Гейджи / Визуальные элементы (`gauges/`)

- **`gauges.component.ts`** (`GaugesManager`, ~46 000 строк) — фабрика и менеджер всех визуальных элементов. Определяет типы гейджей, создаёт/обновляет SVG-элементы, привязывает данные из тегов.

#### Элементы управления (`gauges/controls/`)

| Компонент | Описание |
|-----------|----------|
| `html-input/` | Поле ввода |
| `html-button/` | Кнопка |
| `html-select/` | Выпадающий список |
| `html-chart/` | График (uPlot) |
| `html-graph/` | Диаграмма (Chart.js: bar, pie) |
| `html-table/` | Таблица данных (с кастомизацией, тревогами, отчётами) |
| `html-bag/` | Контейнер (бак/ёмкость с анимацией уровня) |
| `html-switch/` | Переключатель |
| `html-iframe/` | Встроенный iframe |
| `html-image/` | Изображение |
| `html-video/` | Видеоплеер (xgplayer, HLS, FLV) |
| `html-scheduler/` | Планировщик (визуальное расписание) |
| `gauge-progress/` | Прогресс-бар |
| `gauge-semaphore/` | Семафор (светофор) |
| `pipe/` | Труба с анимацией потока |
| `slider/` | Слайдер |
| `panel/` | Панель (вложенный вид) |
| `value/` | Отображение значения тега |

#### Свойства гейджей (`gauges/gauge-property/`)

- Привязка переменных (`flex-variable/`), событий (`flex-event/`), действий (`flex-action/`), разрешений (`permission-dialog/`), виджетов (`flex-widget-property/`).

#### Фигуры (`gauges/shapes/`)

- **`proc-eng/`** — SVG-фигуры технологических объектов (насосы, клапаны, ёмкости).
- **`ape-shapes/`** — дополнительные SVG-фигуры.

### Вспомогательные модули

- **`gui-helpers/`** — UI-компоненты: `ngx-uplot` (графики), `ngx-gauge` (стрелочный прибор), `ngx-nouislider` (ползунок), `ngx-scheduler` (планировщик), `fab-button` (FAB-кнопка), `treetable` (дерево), `confirm-dialog`, `daterange-dialog`, `webcam-player` и др.
- **`framework/`** — переиспользуемый Angular-модуль: директивы, загрузка файлов, touch-клавиатура.
- **`_helpers/`** — утилиты: `utils.ts`, `calc.ts`, `define.ts`, `dictionary.ts`, `windowref.ts`, `endpointapi.ts`, `svg-utils.ts`, HTTP-интерцептор для JWT.
- **`_directives/`** — Angular-директивы: drag-n-drop, числовой ввод, lazy loading, resize, dialog-draggable.
- **`_config/`** — конфигурационные файлы.

### Ключевые зависимости клиента

| Пакет | Назначение |
|-------|-----------|
| `@angular/*` 17.x | Angular-фреймворк |
| `@angular/material` 17.x | UI-компоненты (Material Design) |
| `socket.io-client` | WebSocket-связь с сервером |
| `ngx-translate` | Мультиязычность |
| `chart.js` + `ng2-charts` | Диаграммы (bar, pie) |
| `uplot` | Высокопроизводительные графики реального времени |
| `panzoom` | Масштабирование и перемещение SVG-канваса |
| `angular-gridster2` | Grid-лейаут для карточек |
| `codemirror` | Редактор кода (скрипты) |
| `ngx-color-picker` | Выбор цвета |
| `ngx-toastr` | Toast-уведомления |
| `leaflet` | Интерактивные карты |
| `pdfmake` | Генерация PDF на клиенте |
| `xgplayer` | Видеоплеер (HLS/FLV) |
| `file-saver` | Сохранение файлов |

---

## Архитектура драйверов устройств

### Общая схема

```
devices/index.js          — Менеджер: загрузка, старт, стоп, обновление всех устройств
devices/device.js          — Обёртка-адаптер: StateMachine (INIT→IDLE→POLLING), создание comm-объекта по типу
devices/device-utils.js    — Утилиты: масштабирование, DAQ-решения, парсинг значений
devices/<protocol>/index.js — Конкретный драйвер (comm-объект)
devices/template/index.js  — Шаблон для создания нового драйвера
```

### Жизненный цикл устройства

```
              devices/index.js                    device.js (обёртка)                 <protocol>/index.js (драйвер)
              ────────────────                    ───────────────────                 ────────────────────────────
load()        ─→ loadDevice(cfg)
                   │
                   ├─ Device.create(cfg, runtime) ─→ new Device(data, runtime)
                   │                                   │
                   │                                   ├─ выбор драйвера по data.type
                   │                                   │  (if-else цепочка в конструкторе)
                   │                                   │
                   │                                   ├─ comm = Protocol.create(data, logger, events, manager, runtime)
                   │                                   │                                  │
                   │                                   │                                  └─ new ProtocolClient(data, logger, events, runtime)
                   │                                   │
                   │                                   └─ this.load(data)  ──────────────→  comm.load(data)
                   │
                   ├─ bindGetProperty()
                   ├─ bindUpdateConnectionStatus()
                   ├─ bindSaveDaqValue()  (если DAQ включён)
                   └─ bindGetDaqValueToRestore()
                   
start()       ─→ device.start()
                   │
                   ├─ status = INIT, cmd = START
                   ├─ запуск checkStatus (каждые 5 сек)
                   │     │
                   │     └─ если INIT + START → device.connect()
                   │           │
                   │           ├─ comm.init(type)     (для Modbus: RTU/TCP)
                   │           ├─ comm.connect()  ────────────────────────→  подключение к устройству
                   │           │                                             events.emit('device-status:changed', 'connect-ok')
                   │           │
                   │           └─ запуск polling (setInterval, каждые pollingInterval мс)
                   │                 │
                   │                 └─ comm.polling() ──────────────────→  чтение значений тегов
                   │                                                        events.emit('device-value:changed', {id, values})
                   │                                                        this.addDaq(changed, name, id)  — сохранение в DAQ
                   │
stop()        ─→ device.stop()
                   │
                   ├─ clearInterval (polling + checkStatus)
                   └─ comm.disconnect() ─────────────────────→  отключение от устройства
                                                                  events.emit('device-status:changed', 'connect-off')
```

### Контракт драйвера (интерфейс comm-объекта)

Каждый драйвер (`<protocol>/index.js`) должен экспортировать модуль с двумя функциями:

```js
module.exports = {
    init: function (settings) { },
    create: function (data, logger, events, manager, runtime) {
        return new ProtocolClient(data, logger, events, runtime);
    }
}
```

Конструктор `ProtocolClient` получает:
- **`data`** — конфигурация устройства `{ id, name, type, tags, enabled, property, polling, sharedDevices }`
- **`logger`** — Winston-логгер (`logger.info()`, `logger.warn()`, `logger.error()`)
- **`events`** — EventEmitter для отправки событий в runtime
- **`manager`** — менеджер плагинов (`live-plugin-manager`) для загрузки npm-зависимостей
- **`runtime`** — полный доступ к runtime (скрипты, настройки, etc.)

Экземпляр драйвера **обязан** реализовать следующие методы:

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `init` | `(type) → void` | Инициализация подтипа (напр. Modbus RTU vs TCP) |
| `connect` | `() → Promise` | Подключение к устройству. Emit `device-status:changed` с `connect-ok` или `connect-error` |
| `disconnect` | `() → Promise` | Отключение. Emit `device-status:changed` с `connect-off`. Очистить кэш значений |
| `polling` | `() → async void` | Чтение текущих значений всех тегов. Emit `device-value:changed` с `{id, values}`. Вызвать `this.addDaq()` для изменённых значений |
| `load` | `(data) → void` | Загрузка/обновление конфигурации тегов из `data.tags` |
| `getValues` | `() → Object` | Вернуть все текущие значения `{ [tagId]: { id, value, type, timestamp } }` |
| `getValue` | `(tagId) → Object\|null` | Вернуть `{ id, value, ts }` для одного тега |
| `getStatus` | `() → string` | Вернуть текущий статус: `'connect-off'`, `'connect-ok'`, `'connect-error'`, `'connect-busy'` |
| `getTagProperty` | `(tagId) → Object\|null` | Вернуть `{ id, name, type, format }` для тега |
| `setValue` | `(tagId, value) → bool\|Promise` | Записать значение в тег устройства |
| `isConnected` | `() → bool` | Вернуть `true` если соединение активно |
| `bindAddDaq` | `(fnc) → void` | Привязать функцию DAQ-хранилища: `this.addDaq = fnc` |
| `lastReadTimestamp` | `() → number` | Вернуть timestamp последнего успешного polling |
| `getTagDaqSettings` | `(tagId) → Object\|null` | Вернуть настройки DAQ для тега |
| `setTagDaqSettings` | `(tagId, settings) → void` | Установить настройки DAQ для тега |

**Опциональные методы** (реализуются по необходимости):

| Метод | Описание |
|-------|----------|
| `browse(path, callback)` | Обзор дерева тегов (OPC-UA, BACnet, MQTT, ODBC, Redis) |
| `readAttribute(node)` | Чтение атрибутов узла (OPC-UA) |
| `getTagsProperty()` | Получение конфигурации тегов (WebAPI) |
| `bindGetProperty(fnc)` | Привязка функции доступа к security-свойствам проекта |

### Ключевые события (events)

Драйвер общается с runtime через `events` (EventEmitter):

```js
// Статус подключения — транслируется всем фронтенд-клиентам
events.emit('device-status:changed', { id: data.id, status: 'connect-ok' });
events.emit('device-status:changed', { id: data.id, status: 'connect-error' });
events.emit('device-status:changed', { id: data.id, status: 'connect-off' });

// Значения тегов — транслируются фронтенду через Socket.IO
events.emit('device-value:changed', { id: data.id, values: varsValue });
// где varsValue = { [tagId]: { id, value, type, timestamp, changed, daq, ... } }
```

### Паттерн working-флага (защита от overload)

Все драйверы используют одинаковый паттерн для предотвращения параллельных polling/connect:

```js
var working = false;
var overloading = 0;

var _checkWorking = function (check) {
    if (check && working) {
        overloading++;
        logger.warn(`'${data.name}' working overload! ${overloading}`);
        if (overloading >= 3) {
            // принудительный disconnect при затяжном overload
        }
        return false;
    }
    working = check;
    overloading = 0;
    return true;
};

// Использование:
this.polling = async function () {
    if (!_checkWorking(true)) return;     // блокируем повторный вход
    try {
        // ... чтение тегов ...
    } finally {
        _checkWorking(false);              // освобождаем блокировку
    }
};
```

### Паттерн работы с тегами и DAQ

```js
const deviceUtils = require('../device-utils');

// 1) При polling — для каждого прочитанного тега:
//    a) Преобразовать «сырое» значение через deviceUtils.tagValueCompose():
value = await deviceUtils.tagValueCompose(rawValue, oldValue, tag, runtime);
//    (применяет масштабирование, deadband, формат, скриптовые функции)

//    b) Проверить, нужно ли сохранять в DAQ:
if (this.addDaq && deviceUtils.tagDaqToSave(tag, timestamp)) {
    result[id] = tag;  // собрать в объект для addDaq
}

// 2) При записи (setValue) — обратное масштабирование:
value = await deviceUtils.tagRawCalculator(value, tag, runtime);

// 3) Отправить все значения фронтенду:
events.emit('device-value:changed', { id: data.id, values: varsValue });

// 4) Отправить изменённые значения в DAQ:
if (this.addDaq && !utils.isEmptyObject(changedValues)) {
    this.addDaq(changedValues, data.name, data.id);
}
```

### Структура data.tags

Объект тегов, который приходит в драйвер через `data.tags`:

```js
{
    "tag-guid-1": {
        id: "tag-guid-1",
        name: "Temperature",
        address: "40001",           // адрес в протоколе
        memaddress: "HR",           // область памяти (Modbus: Coil/DI/IR/HR)
        type: "Int16",              // тип данных
        format: 2,                  // число десятичных знаков
        value: null,                // текущее значение
        options: "...",             // протокол-специфичные опции (JSON строка)
        init: "",                   // начальное значение
        daq: {
            enabled: true,
            changed: true,
            interval: 60,
            restored: false
        },
        scale: {                    // масштабирование
            mode: "linear",
            rawLow: 0, rawHigh: 4095,
            scaledLow: 0, scaledHigh: 100
        },
        deadband: { value: 0.5 },
        scaleReadFunction: "script-id",  // id скрипта для трансформации при чтении
        scaleWriteFunction: "script-id"  // id скрипта для трансформации при записи
    },
    // ...
}
```

### Структура data.property

Объект свойств подключения (`data.property`) — специфичен для каждого типа устройства:

| DeviceType | Ключевые поля `property` |
|------------|-------------------------|
| ModbusRTU | `address` (COM-порт), `baudrate`, `databits`, `stopbits`, `parity`, `slaveid`, `options` |
| ModbusTCP | `address` (IP), `port`, `slaveid`, `options` |
| SiemensS7 | `address` (IP), `port`, `rack`, `slot` |
| OPCUA | `address` (endpoint URL), `options` |
| MQTTclient | `address` (broker URL), `port`, `clientId`, `options` |
| BACnet | `address` (IP), `port` |
| EthernetIP | `address` (IP), `slot` |
| WebAPI | `address` (URL), `method`, `format`, `headers` |
| ODBC | `address` (connection string), `options` |
| ADSclient | `address` (AMS Net ID), `port` |
| GPIO | (нет специфичных — теги задают pin-номер) |
| WebCam | `address` (URL потока) |
| MELSEC | `address` (IP), `port` |
| REDIS | `address` (host/URL), `port`, `connectionOption` (simple/hash), `options`, `redisTimeoutMs` |
| EasyDrv | `address` (IP PAC), `port` (def 10000), `timeout` (ms), `pacName` |
| FuxaServer | (нет внешнего подключения — внутренние теги) |

---

## Создание нового драйвера (пошаговое руководство)

### Шаг 1. Серверная часть — создать драйвер

#### 1.1. Скопировать шаблон

```
server/runtime/devices/template/index.js  →  server/runtime/devices/mydriver/index.js
```

#### 1.2. Реализовать интерфейс драйвера

```js
// server/runtime/devices/mydriver/index.js
'use strict';

let MyDriverLib;  // npm-библиотека протокола

const utils = require('../../utils');
const deviceUtils = require('../device-utils');

function MyDriverClient(_data, _logger, _events, _runtime) {
    var data = JSON.parse(JSON.stringify(_data));
    var logger = _logger;
    var events = _events;
    var runtime = _runtime;
    
    var client = null;
    var working = false;
    var overloading = 0;
    var connected = false;
    var lastStatus = '';
    var lastTimestampValue = null;
    var varsValue = {};

    // ── init ──
    this.init = function (_type) {
        // инициализация подтипа если нужно
    };

    // ── connect ──
    this.connect = function () {
        return new Promise(async (resolve, reject) => {
            if (!_checkWorking(true)) return reject();
            try {
                logger.info(`'${data.name}' try to connect ${data.property.address}`, true);
                
                client = new MyDriverLib(/* параметры из data.property */);
                await client.connect();
                
                connected = true;
                _emitStatus('connect-ok');
                logger.info(`'${data.name}' connected!`, true);
                _checkWorking(false);
                resolve();
            } catch (err) {
                connected = false;
                _emitStatus('connect-error');
                _clearVarsValue();
                _checkWorking(false);
                logger.error(`'${data.name}' connect failed! ${err}`);
                reject(err);
            }
        });
    };

    // ── disconnect ──
    this.disconnect = function () {
        return new Promise(async (resolve) => {
            try {
                _checkWorking(false);
                if (client) {
                    await client.close();
                }
            } catch (e) {
                logger.error(`'${data.name}' disconnect failure! ${e}`);
            } finally {
                client = null;
                connected = false;
                _emitStatus('connect-off');
                _clearVarsValue();
                resolve(true);
            }
        });
    };

    // ── polling ──
    this.polling = async function () {
        if (!_checkWorking(true)) return;
        try {
            if (!client || !connected) {
                _checkWorking(false);
                return;
            }
            
            var timestamp = Date.now();
            var changed = {};
            
            for (var id in data.tags) {
                var tag = data.tags[id];
                try {
                    // Прочитать значение из устройства
                    var rawValue = await client.read(tag.address);
                    
                    // Преобразовать через FUXA-утилиты (масштабирование, deadband, скрипты)
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
                        type: tag.type,
                        changed: tagChanged,
                        timestamp: timestamp,
                        daq: tag.daq
                    };
                    
                    // Проверить нужно ли сохранить в DAQ
                    if (this.addDaq && deviceUtils.tagDaqToSave(varsValue[id], timestamp)) {
                        changed[id] = varsValue[id];
                    }
                    varsValue[id].changed = false;
                } catch (err) {
                    logger.error(`'${data.name}' read tag ${tag.name} error: ${err}`);
                }
            }
            
            lastTimestampValue = timestamp;
            _emitValues(varsValue);
            
            if (this.addDaq && !utils.isEmptyObject(changed)) {
                this.addDaq(changed, data.name, data.id);
            }
            
            if (lastStatus !== 'connect-ok') {
                _emitStatus('connect-ok');
            }
        } catch (err) {
            logger.error(`'${data.name}' polling error: ${err}`);
        } finally {
            _checkWorking(false);
        }
    };

    // ── load ──
    this.load = function (_data) {
        data = JSON.parse(JSON.stringify(_data));
        varsValue = {};
        logger.info(`'${data.name}' data loaded (${Object.keys(data.tags).length})`, true);
    };

    // ── getValues / getValue ──
    this.getValues = function () { return varsValue; };
    this.getValue = function (id) {
        if (varsValue[id]) {
            return { id: id, value: varsValue[id].value, ts: lastTimestampValue };
        }
        return null;
    };

    // ── getStatus / isConnected ──
    this.getStatus = function () { return lastStatus; };
    this.isConnected = function () { return connected; };

    // ── getTagProperty ──
    this.getTagProperty = function (id) {
        if (data.tags[id]) {
            return { id: id, name: data.tags[id].name, type: data.tags[id].type, format: data.tags[id].format };
        }
        return null;
    };

    // ── setValue ──
    this.setValue = async function (id, value) {
        if (!client || !connected) return false;
        try {
            var tag = data.tags[id];
            // Обратное масштабирование
            var raw = await deviceUtils.tagRawCalculator(value, tag, runtime);
            await client.write(tag.address, raw);
            return true;
        } catch (err) {
            logger.error(`'${data.name}' setValue error: ${err}`);
            return false;
        }
    };

    // ── DAQ binding ──
    this.bindAddDaq = function (fnc) { this.addDaq = fnc; };
    this.addDaq = null;

    // ── timestamps / DAQ settings ──
    this.lastReadTimestamp = () => lastTimestampValue;
    this.getTagDaqSettings = (tagId) => data.tags?.[tagId]?.daq || null;
    this.setTagDaqSettings = (tagId, settings) => {
        if (data.tags?.[tagId]) {
            utils.mergeObjectsValues(data.tags[tagId].daq, settings);
        }
    };

    // ── Вспомогательные функции ──
    var _emitValues = function (values) {
        events.emit('device-value:changed', { id: data.id, values: values });
    };
    var _emitStatus = function (status) {
        lastStatus = status;
        events.emit('device-status:changed', { id: data.id, status: status });
    };
    var _clearVarsValue = function () {
        for (var id in varsValue) { varsValue[id].value = null; }
        _emitValues(varsValue);
    };
    var _checkWorking = function (flag) {
        if (flag && working) {
            if (++overloading >= 3) { _emitStatus('connect-busy'); overloading = 0; }
            return false;
        }
        working = flag;
        overloading = 0;
        return true;
    };
}

module.exports = {
    init: function (settings) { },
    create: function (data, logger, events, manager, runtime) {
        // Загрузить npm-библиотеку: из node_modules или через plugin manager
        try { MyDriverLib = require('my-protocol-lib'); } catch { }
        if (!MyDriverLib && manager) {
            try { MyDriverLib = manager.require('my-protocol-lib'); } catch { }
        }
        if (!MyDriverLib) return null;
        
        return new MyDriverClient(data, logger, events, runtime);
    }
};
```

### Шаг 2. Серверная часть — зарегистрировать драйвер

#### 2.1. `server/runtime/devices/device.js` — импорт и создание

Добавить `require` в начало файла:

```js
var MYDRIVERclient = require('./mydriver');
```

Добавить тип в `DeviceEnum`:

```js
var DeviceEnum = {
    // ... существующие типы ...
    MyDriver: 'MyDriver'
};
```

Добавить ветку в конструкторе `Device()` (в цепочке if-else):

```js
} else if (data.type === DeviceEnum.MyDriver) {
    if (!MYDRIVERclient) {
        return null;
    }
    comm = MYDRIVERclient.create(data, logger, events, manager, runtime);
}
```

Если драйвер поддерживает `browse`, добавить в метод `this.browse`:

```js
} else if (data.type === DeviceEnum.MyDriver) {
    comm.browse(path, callback).then(resolve).catch(reject);
}
```

Если нужен `bindGetProperty` (для security), добавить в соответствующий if:

```js
if (data.type === DeviceEnum.OPCUA || ... || data.type === DeviceEnum.MyDriver) {
    comm.bindGetProperty(fnc);
}
```

### Шаг 3. Клиентская часть — зарегистрировать тип

#### 3.1. `client/src/app/_models/device.ts` — добавить в enum

```typescript
export enum DeviceType {
    // ... существующие типы ...
    MyDriver = 'MyDriver'
}
```

**Важно:** строковое значение (`'MyDriver'`) должно **точно совпадать** с `DeviceEnum.MyDriver` на сервере.

#### 3.2. `client/src/app/device/device-property/device-property.component.html`

Добавить блок настроек подключения для нового типа (поля address, port и т.д.) по аналогии с существующими. Шаблон условно показывает/скрывает поля через `*ngIf="data.device.type === deviceType.MyDriver"`.

#### 3.3. `client/src/app/device/device-map/device-map.component.ts`

Если нужны специфичные типы тегов, добавить их аналогично существующим:

```typescript
export enum MyDriverTagType {
    Number = 'number',
    Boolean = 'boolean',
    String = 'string'
}
```

И добавить в компоненте `device-map` маппинг типов для нового устройства.

#### 3.4. `client/src/app/device/tag-property/` (опционально)

Если теги имеют специфичные свойства (адресация, типы), создать компонент `tag-property-edit-mydriver/` по аналогии с существующими (например, `tag-property-edit-modbus`).

### Шаг 4. Зарегистрировать компоненты в Angular

#### 4.1. `client/src/app/app.module.ts`

- Добавить `import` нового компонента
- Добавить в `declarations` массив NgModule

### Шаг 5. Внешние npm-зависимости

Если драйвер использует npm-пакет:

**Вариант A — встроенная зависимость:**
```bash
cd server && npm install my-protocol-lib
```

**Вариант B — через систему плагинов (live-plugin-manager):**
Пользователь устанавливает через UI (Editor → Plugins). В `create()` драйвера попытка загрузить через `manager.require()`:
```js
try { MyDriverLib = require('my-protocol-lib'); } catch { }
if (!MyDriverLib && manager) {
    try { MyDriverLib = manager.require('my-protocol-lib'); } catch { }
}
```

### Сводка файлов для изменения

| Файл | Действие |
|------|----------|
| `server/runtime/devices/mydriver/index.js` | **Создать** — реализация драйвера |
| `server/runtime/devices/device.js` | **Изменить** — import, DeviceEnum, конструктор Device |
| `client/src/app/_models/device.ts` | **Изменить** — DeviceType enum |
| `client/src/app/device/device-property/` | **Изменить** — UI настроек подключения |
| `client/src/app/device/device-map/` | **Изменить** — маппинг тегов |
| `client/src/app/device/tag-property/tag-property-edit-mydriver/` | **Создать** (опц.) — UI свойств тегов |
| `client/src/app/app.module.ts` | **Изменить** — регистрация компонентов |

### Существующие драйверы — краткое описание реализации

| Драйвер | npm-библиотека | Особенности |
|---------|---------------|-------------|
| `modbus/` | `modbus-serial` | RTU/TCP, области памяти (Coil/DI/IR/HR), shared serial port через Mutex, batch-чтение по регистрам |
| `s7/` | `node-snap7` | Siemens S7-300/400/1200/1500, чтение DB/MK/I/Q блоками |
| `opcua/` | `node-opcua` | OPC-UA, browse дерева, подписка на изменения, security policies, сертификаты |
| `bacnet/` | `node-bacnet` | BACnet IP, browse устройств, чтение/запись property |
| `mqtt/` | `mqtt` | Pub/Sub, topics, QoS, TLS/сертификаты, JSON-парсинг payload |
| `ethernetip/` | внешний плагин | Allen Bradley Ethernet/IP |
| `httprequest/` | `axios` | REST API polling, GET/POST, JSON/CSV парсинг |
| `odbc/` | `odbc` | SQL-запросы к внешним БД, browse таблиц |
| `adsclient/` | `ads-client` | Beckhoff TwinCAT ADS, символьные переменные |
| `gpio/` | — | Raspberry Pi GPIO, digital I/O, edge-прерывания |
| `webcam/` | — | Захват кадров с IP-камер по URL |
| `melsec/` | внешний | Mitsubishi MELSEC MC Protocol |
| `redis/` | `redis` | Redis GET/SET, HGET/HSET, SCAN browse, custom commands |
| `easydrv/` | — (net) | EasyDrv PAC: TCP binary framing, Lua response parsing, browse devices, set tags |
| `fuxaserver/` | — | Внутренние теги FUXA (без внешнего подключения), используется скриптами |

---

## Коммуникация клиент ↔ сервер

### Socket.IO (реальное время)

Клиент (`HmiService`) подключается к серверу через Socket.IO с JWT-токеном. Основные события:

| Событие | Направление | Описание |
|---------|-------------|----------|
| `device-status` | ↔ | Статус устройств (online/offline/error) |
| `device-values` | server → client | Текущие значения тегов |
| `device-values` (cmd: set) | client → server | Запись значения в тег |
| `device-browse` | client → server → client | Обзор дерева тегов устройства |
| `device-property` | client → server → client | Свойства устройства |
| `device-tags-subscribe` | client → server | Подписка на теги текущего вида |
| `daq-query` / `daq-result` | client ↔ server | Запрос/получение исторических данных |
| `alarms-status` | server → client | Статусы тревог |
| `heartbeat` | server → client | Проверка связи (каждые 10 сек) |
| `script-console` | server → client | Вывод консоли скриптов |
| `scheduler:updated` | server → client | Обновление расписаний |

### REST API (HTTP)

Используется для CRUD-операций (проект, пользователи, настройки, тревоги, DAQ-запросы, отчёты и т.д.).  
Базовый путь: `/api/`.  
Аутентификация: JWT-токен в заголовке `x-access-token` или API-ключ.  
Rate limiting: 100 запросов / 5 минут.

---

## Безопасность

- **JWT-аутентификация** — токены с настраиваемым временем жизни (`tokenExpiresIn`).
- **Ролевая модель** — поддержка групп и ролей (`userRole`), разрешения на уровне видов и элементов (show/enabled).
- **API-ключи** — для внешнего программного доступа.
- **Rate limiting** — ограничение частоты запросов к API.
- **CORS** — настраиваемые разрешённые источники (`allowedOrigins`).
- **bcryptjs** — хеширование паролей.
- **Socket.IO авторизация** — проверка JWT при подключении, запрет записи для неавторизованных сокетов.
