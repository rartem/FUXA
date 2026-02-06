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
