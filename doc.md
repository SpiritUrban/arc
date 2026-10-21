# Архів концепції ARC

> Історичне обговорення задуму, збережене без переписування прикладів. Це не інструкція до поточного API. Зокрема, `compile()` у ARC 0.2 не відкриває ресурси; для виконання потрібен `start()`. Fluent schemas, автоматичні deployment/what-if можливості та інші ідеї нижче можуть бути ще не реалізовані.
>
> Актуальна документація: [посібник ARC 0.3](docs/README.md), [API](docs/api.md), [міграція](docs/migration-0.2.md), [стан реалізації й roadmap](docs/audit/web-fullstack-report.md).

---

якби ти писав свій нод жс фреймворк заново, що б ти зробив по іншому на відміну від того як зараз зроблені поточні популярні фреймворки. можливо в тебе є інше своє бачення

Так. Якби я сьогодні з нуля проєктував власний Node.js backend-фреймворк, я б не починав з роутера. Я б починав із моделі виконання застосунку.

Моя основна теза була б така:

    Застосунок — це граф операцій, контрактів, ресурсів і залежностей. HTTP — лише один зі способів викликати ці операції.

Це суттєво відрізняється від Express/Nest/Fastify-підходу.
Що мене не влаштовує в існуючих моделях

Express простий і геніальний, але його фундаментальна модель — послідовність middleware, які мутують req/res і передають керування через next(). Тому поведінка системи часто залежить від порядку реєстрації.

Nest вирішив проблему структури великих застосунків, але ціною великої кількості понять:

Module → Controller → Provider → Guard → Pipe → Interceptor → Filter → Decorator

і всередині DI-контейнер.

Коли проєкт великий — працює. Але дуже часто код перетворюється на архітектурну церемонію.

Fastify мені концептуально подобається значно більше. Особливо schema-based validation/serialization та encapsulation плагінів, яка фактично утворює DAG контекстів.

Hono пішов у ще одному правильному напрямку — Web Standards, тобто стандартні Request, Response, Headers, URL, через що модель переноситься між Node, Bun, Deno, Workers тощо.

Але практично всі вони все одно обертаються навколо:
request
 ↓
middleware
 ↓
middleware
 ↓
handler
 ↓
middleware
 ↓
response

Я б це змінив.
1. Центральною сутністю була б operation, а не route

Наприклад:

const getUser = operation({
  input: {
    id: string.uuid()
  },

  output: User,

  errors: {
    USER_NOT_FOUND: 404
  },

  needs: {
    users: UsersRepository,
    currentUser: CurrentUser,
  },

  async run({ input, users, currentUser }) {
    const user = await users.find(input.id)

    if (!user)
      return error('USER_NOT_FOUND')

    return ok(user)
  }
})

Це ще не HTTP endpoint.

Це просто операція системи.

А вже потім:

http.get('/users/:id', getUser)

Або:

rpc.expose('users.get', getUser)

Або:

queue.handle('get-user', getUser)

Або навіть:

cli.command('user:get', getUser)

Таким чином бізнес-логіка не знає, звідки її викликали.

HTTP стає адаптером.
2. Замість DI container — capabilities

Ось це я б зробив одним із фундаментальних принципів.

Не:

@Injectable()
class UserService {
  constructor(
    private db: Database,
    private logger: Logger,
    private config: Config,
    private cache: Cache
  ) {}
}

А:

const createUser = operation({
  needs: {
    users: UsersRepository,
    mail: Mailer,
    clock: Clock
  },

  async run(ctx) {}
})

Операція фізично не має доступу до того, чого не попросила.

Наприклад:

ctx.db

навіть не існує, якщо Database не оголошений.

Це дуже корисна властивість.

Фактично:
operation
 ├── UsersRepository
 ├── Mailer
 └── Clock

стає частиною архітектури.

Фреймворк бачить весь dependency graph.
3. Framework як compiler

Оце, мабуть, найбільша відмінність.

Більшість Node-фреймворків я сприймаю як runtime libraries.

Мій був би частково application compiler.

Під час старту:

await app.compile()

він будує граф:
HTTP GET /users/:id

        │
        ▼
    getUser
    /     \
UsersRepo CurrentUser
    │         │
 PostgreSQL Session
              │
             Redis

І ще ДО запуску сервера ловить:
Missing dependency
Circular dependency
Scope violation
Route collision
Invalid schema
Duplicate operation id
Impossible dependency graph
Invalid error mapping

Наприклад:
ERROR

UserRepository
      ↓
UserService
      ↓
EmailService
      ↓
UserRepository

Circular dependency detected.

А не через 20 секунд після першого HTTP request.
4. Middleware я б замінив на dependency/effect graph

Наприклад зараз часто:

app.use(cors())
app.use(logger())
app.use(auth())
app.use(rateLimit())
app.use(transaction())

І тут порядок уже є частиною логіки.

Я б зробив:

const adminOperation = operation({
  needs: {
    user: authenticatedUser,
    permission: permission('admin'),
    db: transaction
  }
})

А permission сам говорить:

const permission = capability({
  needs: {
    user: authenticatedUser
  },

  provide(ctx) {
    ...
  }
})

Тобто фреймворк сам розуміє:
session
   ↓
authenticatedUser
   ↓
permission
   ↓
operation

Не програміст визначає порядок:

auth()
permission()
handler()

Граф визначає порядок.

Це дуже велика різниця.
5. Один контракт замість п'яти описів одного DTO

Оце мене особливо дратує в backend.

Іноді одна сутність описана:
TypeScript interface
DTO
validator
Swagger schema
ORM model
frontend type

Я б зробив contract-first ядро.

Наприклад:

const User = schema({
  id: uuid(),
  name: string(),
  age: int().min(0)
})

І з цього отримуємо одночасно:
runtime validation
TypeScript type
JSON Schema
OpenAPI
serialization
API client
mock generator
test fixtures

Тобто:

type User = Infer<typeof User>

А endpoint:

const createUser = operation({
  input: CreateUser,
  output: User
})

автоматично дає frontend:

api.users.create({
  name: 'Vitaliy'
})

з нормальною типізацією.

Fastify вже рухається в хороший бік із schema-based validation/serialization, але я зробив би schema/contract ще більш центральною частиною архітектури.
6. Expected errors не повинні бути exceptions

Я взагалі не люблю:

throw new NotFoundException()

для нормальної бізнес-ситуації.

Наприклад відсутність користувача — це не exception.

Я б використовував:

return error('USER_NOT_FOUND')

І контракт:

errors: {
  USER_NOT_FOUND: {
    status: 404,
    schema: ...
  },

  FORBIDDEN: {
    status: 403
  }
}

Тоді TypeScript знає:

Result<
  User,
  'USER_NOT_FOUND' | 'FORBIDDEN'
>

А справжній:

throw error

означає:

    система реально зламалася.

Це сильно покращує observability.
7. Ніяких decorators як фундаменту

Я б допускав:

@route()
@inject()

як optional syntactic sugar.

Але ядро було б звичайним TypeScript:

export const users = module({
  operations: {
    createUser,
    getUser,
    deleteUser
  }
})

Причина проста.

Функції й об'єкти:

    легко рефакторити;
    легко тестувати;
    легко аналізувати statically;
    немає прихованого metadata layer;
    немає особливого lifecycle класів.

8. Scope був би частиною type system фреймворку

Наприклад:

const database = resource({
  scope: 'application'
})

const transaction = resource({
  scope: 'request',
  needs: { database }
})

const currentUser = resource({
  scope: 'request'
})

Framework не дозволить:
application-scoped service
        ↓
request-scoped dependency

якщо це створює scope leak.

Причому бажано ловити це навіть TypeScript-ом.
9. AsyncLocalStorage я б використовував дуже обмежено

Node зараз має стабільний AsyncLocalStorage, спеціально призначений для перенесення стану через promise/callback chain.

Я б використовував його для:
traceId
requestId
logging context
OpenTelemetry span

Тобто:

logger.info('User created')

автоматично отримує:

{
  "requestId": "...",
  "traceId": "...",
  "operation": "users.create"
}

Але не клав би туди DB, currentUser, services тощо.

Бо тоді знову отримуємо Service Locator, тільки добре замаскований.
10. Observability була б вбудована в execution graph

Якщо framework знає:
HTTP
 ↓
auth
 ↓
permission
 ↓
transaction
 ↓
UsersRepository
 ↓
Postgres

він автоматично може видати trace:
GET /users/123                    41ms

├ auth                           2ms
├ permission                     0.2ms
├ transaction                    1ms
│
├ operation:getUser             35ms
│   └ UsersRepository.find      34ms
│       └ postgres.query        32ms
│
└ serialize                      0.3ms

Без:

logger.time()

на кожному кроці.
11. Тестувати можна було б operation без HTTP

Наприклад:

const result = await test(getUser)
  .provide(UsersRepository, fakeUsers)
  .provide(CurrentUser, admin)
  .run({
    id: '123'
  })

Все.

Не треба:
start server
supertest
HTTP serialization
DI test module
mock provider
override provider

А integration test:

await test.http(app)
  .get('/users/123')
  .expect(200)

12. Ресурси мали б нормальний lifecycle

Наприклад:

const postgres = resource({
  async open(config) {
    return new Pool(config)
  },

  async close(pool) {
    await pool.end()
  }
})

Framework знає dependency order.

Тому shutdown:
HTTP server
↓
workers
↓
repositories
↓
postgres

відбувається автоматично у правильному порядку.

Не потрібно:

process.on('SIGTERM', async () => {
   ...
})

розкидати по застосунку.
13. Feature module замість technical module

Я б рекомендував:
users/
    user.schema.ts
    create-user.ts
    get-user.ts
    user.repository.ts
    index.ts

orders/
    create-order.ts
    cancel-order.ts
    order.repository.ts

payments/
    charge.ts

а не:
controllers/
services/
repositories/
dtos/
entities/
guards/

Бо другий варіант групує код за технічним типом, а не за предметною областю.
14. Framework сам міг би показати архітектуру

Наприклад:

framework graph

отримуємо:
users.create
 ├─ auth.currentUser
 │   └─ sessionStore
 │       └─ redis
 │
 ├─ users.repository
 │   └─ postgres
 │
 └─ mailer
     └─ smtp

А:

framework inspect users.create

видає:
POST /users

Input:
  CreateUser

Output:
  User

Errors:
  EMAIL_EXISTS 409
  FORBIDDEN    403

Capabilities:
  CurrentUser
  UsersRepository
  Mailer

Side effects:
  postgres.write
  mail.send

Оце для великого проєкту було б шалено корисно.
І ще одна річ, яку я б зробив радикально

Я б розділив pure logic і effects.

Наприклад:

function calculateOrderPrice(order, rules) {
    ...
}

Framework до цього взагалі не має стосунку.

А effect:

const saveOrder = effect(...)

або:

const chargeCard = effect(...)

явно позначений як IO.

У результаті великий backend виглядає концептуально приблизно так:
             contracts
                 │
                 ▼
              operation
             /    |    \
            /     |     \
       pure       │     effects
       logic      │
                  │
             capabilities
              /       \
         postgres     redis

І це, на мій погляд, набагато здоровіша модель.
Якщо дуже коротко — що це був би за фреймворк

Я б узяв:

від Express — простоту;

від Fastify — продуктивність, schemas та encapsulation;

від Hono — Web Standards;

від Nest — серйозне ставлення до архітектури великих застосунків;

але викинув би центральність:
middleware
classes
decorators
DI container
mutable request context

і замінив би це на:
              Application Graph

       ┌──────── operation ────────┐
       │                           │
   contracts                 capabilities
       │                      /    |    \
       │                    DB    auth   cache
       │                     │
       └──── types ──────────┘

              ↓ compile

HTTP / RPC / Queue / Cron / CLI

І, мабуть, найважливіше: фреймворк не повинен ховати архітектуру застосунку. Він повинен робити її видимою.

Мені здається, тут реально є простір для нового Node-фреймворку, а не просто 147-го роутера. Особливо цікава ідея typed capability/effect graph + contracts + compilation — я не бачу серед основних Node-фреймворків такого поєднання як центральної моделі.
схоже у твоєму підході на відміну від експресу з міделварами. операція задіює тільки необхідні шари а не так що будь який запит проходить через стандартні обробки, які йому й не потрібні. як думаєш, твоя версія фреймворку буде працювати швидше ніж експрес жс і на скільки відсотків? і які ще виграшні сторони у твоїй архітектурі?

Так, ти правильно зловив головну різницю. У Express типовий запит часто проходить через ланцюжок:
request
 ↓
logger
 ↓
cors
 ↓
body parser
 ↓
session
 ↓
auth
 ↓
rate limiter
 ↓
router
 ↓
handler

навіть якщо конкретному endpoint частина цього взагалі не потрібна.

У моїй моделі для кожної операції під час compile() будувався б окремий мінімальний execution plan:
GET /health

health()

а для:
POST /orders

вже:
parse body
   ↓
validate
   ↓
authenticate
   ↓
check permission
   ↓
transaction
   ↓
createOrder

Тобто це не просто "middleware оптимізовані". Це фактично dead-code elimination для request pipeline.
Чи буде це швидше за Express?

Так, потенційно. Але я б не обіцяв щось типу "на 70% швидше", поки немає реального benchmark.

У простому HTTP benchmark, де бізнес-логіки майже немає:

GET /ping
→ "pong"

я думаю, грамотно реалізований framework міг би бути приблизно на 20–60% швидшим за Express саме за рахунок меншої кількості диспетчеризації, next(), перевірок middleware і динамічної роботи під час request.

У спеціально невигідному для Express випадку:
15-30 global middleware

з яких конкретному route потрібні лише 2-3, різниця потенційно могла б бути навіть:
1.5x–2x+

Але це синтетичний випадок.

У реальному endpoint:
HTTP            0.1–1 ms
DB             10–40 ms
Redis           1–3 ms
external API   50–300 ms

виграш framework overhead може дати всього:
Express        31 ms
наш framework 29 ms

тобто умовно 5–10% end-to-end, хоча сам framework layer став швидшим удвічі.

Тому я б розділяв:
framework overhead → потенційно +20–100%
реальний API       → часто +3–20%

залежно від endpoint.

І ще важливий момент: Fastify вже дуже добре оптимізований. З ним змагатися було б значно складніше, ніж з Express. Наївна реалізація моєї архітектури цілком могла б програвати Fastify.

Але сама архітектура дозволяє зробити кілька дуже цікавих оптимізацій.
1. Execution plan компілюється один раз

Замість того щоб кожен request робив:

for (const middleware of stack) {
    if (middleware.matches(req)) {
        ...
    }
}

при запуску framework знає:
/users/:id
needs:
    auth
    usersRepository

і може фактично згенерувати:

async function executeGetUser(req) {
    const input = validateGetUser(req)

    const user = await resolveAuth(req)

    return getUser({
        input,
        user,
        users: usersRepository
    })
}

Тобто між HTTP і бізнес-функцією майже немає framework machinery.

Це вже схоже трохи не на framework, а на JIT/AOT compiler для backend.
2. Можна навіть генерувати спеціалізований handler

Оце мені особливо подобається.

Маємо:

operation({
    input: GetUserInput,
    needs: {
        users,
        currentUser
    }
})

Framework на старті може створити оптимізовану функцію:

const handler = async req => {
    const id = req.params.id

    if (!uuidCheck(id))
        return INVALID_ID_RESPONSE

    const session = await sessionStore.get(
        req.headers.authorization
    )

    if (!session)
        return UNAUTHORIZED_RESPONSE

    const user = await users.find(id)

    if (!user)
        return USER_NOT_FOUND_RESPONSE

    return serializeUser(user)
}

У production вже не потрібні:
dependency lookup
metadata lookup
middleware matching
reflection
decorator inspection
dynamic DI

Все це сталося під час compilation.
Але швидкість — навіть не головний виграш

Я вважаю, що найбільші плюси цієї архітектури були б в інших місцях.
1. Значно менше прихованої роботи

У звичайному backend дивишся:

async getUser(req, res) {
   ...
}

і не бачиш, що перед цим відбулося:
middleware №1
middleware №2
global guard
interceptor
auth middleware
request transform

А тут операція сама говорить:

needs: {
    currentUser,
    users
}

Тобто ти відкрив файл і одразу бачиш усі зовнішні залежності.
2. Security by construction

Оце може бути дуже сильною стороною.

Наприклад:

const deleteUser = operation({
    needs: {
        admin: AdminUser,
        users: UsersRepository
    }
})

Така функція фізично не може бути випадково викликана без AdminUser.

Framework бачить:
HTTP
 ↓
Session
 ↓
AuthenticatedUser
 ↓
AdminUser
 ↓
deleteUser

Якщо хтось спробує підключити:

http.delete('/users/:id', deleteUser)

без механізму отримання AdminUser, application просто не компілюється.

Це набагато надійніше ніж:

    ой, здається, ми забули поставити authMiddleware на одному роуті.

3. Можна визначати дуже цікаві правила архітектури

Наприклад:
Payments operations
may access:
    PaymentsRepository
    UserRepository

may NOT access:
    AdminRepository

Framework може перевіряти це при build.

Або:
domain layer
     ↓
cannot depend on
     ↓
HTTP

Тобто архітектурні правила перестають бути README:

    будь ласка, не імпортуйте controller із service.

Framework реально їх enforce'ить.
4. З графа автоматично видно blast radius

Припустимо ти змінюєш:
RedisSessionStore

Framework знає граф:
RedisSessionStore
    ↓
Session
    ↓
CurrentUser
   /   |    \
orders users payments

IDE/tool може сказати:
Changing RedisSessionStore potentially affects:

17 operations
6 HTTP endpoints
2 queue handlers
1 cron job

Це дуже корисно у великому проекті.
5. Можна автоматично оптимізувати initialization

Наприклад застосунок має:
Postgres
Redis
S3
Stripe
SMTP
OpenAI
ElasticSearch

але worker:
email-worker

використовує лише:
Postgres
SMTP

Framework може запустити тільки їх.

Тобто:

app start email-worker

не піднімає:
Redis
Stripe
OpenAI
ElasticSearch
S3

Це вже виграш:

    startup time;
    memory;
    connections;
    cloud cost.

6. Дуже природний serverless

Це взагалі цікаво.

У serverless зараз часто весь application bootstrap робиться заради однієї Lambda.

А тут framework бачить:
lambda createOrder
     ↓
CreateOrder
     ↓
Postgres
Stripe

і bundle може містити тільки це дерево.

Не:
entire application

а:
createOrder.bundle.js

CreateOrder
OrderRepository
PostgresAdapter
StripeAdapter

Тобто tree shaking вже відбувається не лише на рівні JS imports, а на рівні application architecture.
7. Один application можна легко розкласти на процеси

Наприклад спочатку моноліт:
App
├ users
├ orders
├ payments
├ emails
└ analytics

Потім кажемо:

deploy({
    api: [
        users,
        orders,
        payments
    ],

    workers: [
        emails,
        analytics
    ]
})

Framework бачить залежності й може сказати:
payments → OrdersRepository

і запропонувати:
local call

або після розділення:
RPC call

Це підводить до ще більш цікавої ідеї.
8. Local function ↔ RPC можна зробити майже прозорими

Наприклад:

const chargeOrder = operation(...)

Спочатку:
Orders
   ↓
chargeOrder

в одному процесі.

Потім Payments винесли в інший service.

Можна змінити provider:

provide(chargeOrder, rpc(
    'payments.chargeOrder'
))

А бізнес-код:

await chargeOrder(...)

не змінюється.

Тобто monolith → distributed system можна робити значно контрольованіше.

Я б, звісно, не приховував факт мережевого виклику повністю, тому що distributed call ≠ function call.

Але контракт залишався б той самий.
9. Автоматична документація була б реально точною

Swagger часто бреше.

Наприклад API змінили, decorator забули.

У цьому framework:
operation contract

і є source of truth.

З нього:
OpenAPI
RPC schema
frontend SDK
CLI documentation
tests
mock server

Тому документація фізично не може сильно розійтися з implementation.
10. Дуже хороший playground/debugger

Я б зробив щось типу:

framework dev

і UI:
GET /orders/:id

Execution graph

Request
  │
  ├─ ParseParams       0.03ms
  │
  ├─ CurrentUser       0.81ms
  │    └─ Redis        0.65ms
  │
  ├─ Permission        0.02ms
  │
  ├─ OrderRepository   4.8ms
  │    └─ PostgreSQL   4.4ms
  │
  └─ Serialize         0.09ms

Total: 5.9ms

І можна натиснути на вузол і побачити:
input
output
cache hit/miss
error
duration

Це могло б бути однією з killer features.
11. Кешування можна зробити розумнішим

Бо framework знає dependency graph.

Наприклад:

const getCountry = operation({
    pure: true,
    needs: {
        countries: CountriesRepository
    }
})

і:

cache({
    key: ({ id }) => id,
    ttl: '10m'
})

А ще цікавіше:
updateCountry
     ↓
invalidates
     ↓
getCountry
getCountries

Framework може побудувати cache dependency graph.
12. Паралельне виконання

Оце ще одна перевага DAG над middleware.

Припустимо:
              operation
              /       \
      CurrentUser    FeatureFlags
          │              │
        Redis          Config

Ці дві залежності одна від одної не залежать.

Звичайний pipeline може зробити:
CurrentUser  3 ms
then
FeatureFlags 4 ms

= 7 ms

Graph executor бачить незалежність і запускає:
CurrentUser ───── 3ms
FeatureFlags ──────── 4ms

разом.

Разом:
~4 ms

Тобто DAG дає не лише:

    не виконувати зайве

а ще й:

    виконувати незалежне паралельно.

І ось тут уже можуть з'явитися цілком реальні end-to-end gains.
Я б сформулював перевагу так

Express:
request
  ↓
послідовність команд

Мій варіант:
request
  ↓
dependency graph
  ↓
compiler
  ↓
optimal execution plan

Тобто різниця приблизно як між:
скриптом

і
декларативною програмою + compiler

І я навіть думаю, що головна selling point такого framework не повинна бути "ми швидше Express".

Швидкість — приємний бонус.

Я б позиціонував його десь так:

    Define what an operation needs.
    The framework figures out how to execute it.

А три головні властивості:
1. Nothing unnecessary runs.
2. Nothing undeclared is accessible.
3. The entire architecture is inspectable.

Оце вже, на мою думку, реально інша парадигма Node backend, а не просто новий синтаксис поверх того самого HTTP pipeline.
також схоже що в твоєму розумінні центральною істиною є граф. я згоден і ще зараз важливий такий момент як огляд архітектури системи, її реалізації не через код (який зараз швидко генерується) а через вищий рівень абстракції - якусь візуалізацію цього графу, заміри і оціники при компіляції прописані в цій візуалізації і моніторинг роботи системи в реальному часі - наприклад - бачимо як крутиться на фоні якийсь процес (модуль), як пішов запит і робота з базою данних, кількість запитів на хвилину на шині входу ...

Саме так. Я б навіть підняв цю тезу ще вище: код перестає бути головним способом зрозуміти систему; код стає деталлю реалізації вузлів графа. А граф — це семантичне стиснення всього репозиторію.

Я уявляю це приблизно так: один і той самий граф живе в трьох станах — design → compile → runtime.

Критично важливо, щоб це не була ще одна окрема observability-панель, яка намагається відновити архітектуру з логів і traces. Візуалізація повинна бути прямою проєкцією того самого графа, з якого framework побудував execution plan.

Умовно:
           source code
               │
               ▼
       Architecture IR
       /      |       \
      /       |        \
 compiler    UI       deploy
    │         │          │
execution   graph      bundles
 plan
    │
    ▼
 runtime telemetry
    │
    └──────────► той самий graph

Я б навіть назвав внутрішнє представлення не просто dependency graph, а Architecture IR — аналог compiler intermediate representation.

Вузлами там були б не тільки functions:
Operation
Resource
Database
Table / Collection
Queue
Topic
Worker
Cron
Cache
External API
Filesystem
Process
Deployment unit

А ребра мали б тип, бо один плоский dependency graph швидко перетвориться на локшину:
DEPENDS_ON
CALLS
READS
WRITES
EMITS
SUBSCRIBES
SPAWNS
CACHES
INVALIDATES

Наприклад:
HTTP POST /orders
        │ invokes
        ▼
   CreateOrder
    /    |     \
   /     |      \
needs   writes   emits
 /       |         \
User   Orders     OrderCreated
         │             │
         ▼             ▼
     PostgreSQL    MailWorker
                       │
                       ▼
                      SMTP

І це вже значно більше інформації, ніж можна отримати з дерева файлів.
Compile mode я б зробив особливо цікавим

Ти натискаєш Compile і на граф накладаються результати статичного аналізу.

Наприклад:
CreateOrder
p95 budget:        50 ms
estimated path:    17 ms
allocations:       ~14 KB/request
DB calls:          max 2
network calls:     1
fan-out:           3

А десь вузол червоний:
⚠ GetDashboard

potential queries/request: 47
estimated critical path: 128 ms
budget: 80 ms

possible N+1:
Dashboard
 └─ UsersRepository.find()
      called inside collection mapping

Або:
⚠ ImportUsers

unbounded parallel fan-out

CSV rows
   ├─ DB write
   ├─ DB write
   ├─ DB write
   └─ ...

Framework ще до запуску каже:

    При 10 000 рядках ця операція потенційно створить 10 000 concurrent promises.

Оце вже дуже сильна штука.
А Runtime mode перетворює граф на живу систему

Твій приклад із шиною входу — саме туди.

Зверху:
HTTP INGRESS

248 req/min
37 concurrent
p50 14 ms
p95 48 ms
p99 96 ms

2.1% 4xx
0.07% 5xx

І ти бачиш буквально потік:
          248 rpm
             ↓
        ┌─────────┐
        │ HTTP    │
        └────┬────┘
             │ 182 rpm
             ▼
         CurrentUser
             │
             ▼
        CreateOrder ───────► Postgres
             │                86 qpm
             │
             ▼
        OrderEvents
         depth: 3
             │
             ▼
         MailWorker
          busy:31%

Не в сенсі декоративної анімації. Товщина/активність ребра реально відображає throughput.

Наприклад:
──────     5 calls/min
━━━━━━━━  800 calls/min

Колір вузла:
normal
warning
saturated
failing

А навколо фонового процесу можна показувати:
ImageProcessor

● RUNNING
3 workers
CPU 62%
queue 412
processing 28 jobs/sec
ETA drain 14 sec

Тобто буквально видно, що він крутиться.
І trace окремого request поверх загального графа

Це ще цікавіше.

Ти дивишся загальну систему:
[system mode]

і клікаєш на один request.

Граф гасне, а його маршрут підсвічується:
Request #a73f

HTTP
 │ 0.18 ms
 ▼
Auth
 │ 1.4 ms
 ▼
CreateOrder
 ├─────────────► PostgreSQL
 │                  5.7 ms
 │
 └─────────────► Stripe
                   87 ms

Відразу видно:
total                 96 ms
framework overhead   0.4 ms
application           7 ms
database              6 ms
external I/O         82 ms

І питання:

    чому endpoint гальмує?

вирішується майже без читання коду.
Але я б додав четвертий режим — History

Ось це важливо.
DESIGN
COMPILE
LIVE
HISTORY

History дозволяє поставити:
14:00 ─────────── 18:00

і подивитися, що відбувалося із системою.

Наприклад о 16:37:
traffic +220%

        ↓

UsersRepository
connection wait
2ms → 47ms

        ↓

GET /feed
p95
31ms → 184ms

Тобто щось на кшталт time machine для архітектури.
І ще цікавіше: порівняння compile estimate ↔ reality

Наприклад compiler прогнозував:
CreateOrder

expected:
12-25 ms

А runtime показує:
actual p95:
71 ms

UI:
CreateOrder

estimated      18 ms
actual p95     71 ms
               ▲
             +294%

і framework каже:
Primary deviation:

Stripe.charge

expected: ~10ms
actual:    54ms

Тобто compile-time модель самокалібрується реальністю.

Через деякий час оцінювач уже може знати:
PostgreSQL SELECT by PK
у цьому deployment:
p50 ≈ 1.7 ms
p95 ≈ 4.3 ms

і використовувати не абстрактні цифри, а історичні характеристики саме твого застосунку.
Тут народжується ще одна дуже сильна штука — What if?

Ти можеш у UI сказати:
Traffic × 5

і framework моделює:
Current                         ×5

HTTP       250 rpm            1250 rpm
DB          90 qpm             450 qpm
Pool usage   22%                 91%
Worker       31%                100%
Queue         3                 growing

і підсвічує:
First predicted bottleneck:

MailWorker
~870 req/min

Або:
what if Postgres latency ×2?
what if Redis unavailable?
what if Stripe p95 = 500 ms?

Оскільки є граф залежностей, framework розуміє, куди пошириться деградація.
А ще я зробив би Architecture Diff

Наприклад pull request.

Було:
CreateOrder
 ├ DB
 └ Events

Стало:
CreateOrder
 ├ DB
 ├ Redis
 ├ Stripe
 └ Events

PR показує:
Architecture changes

+ dependency: Stripe
+ dependency: Redis

CreateOrder:
critical path     +43ms
failure surfaces  2 → 4
external services 0 → 1

Це значно цінніше за:
+184
-72 lines

Бо кількість змінених рядків майже нічого не говорить про архітектурний ризик.
І тут ти дуже правильно зачепив сучасну проблему з AI-кодом

Коли код було дорого писати, код сам був значною частиною інтелектуальної роботи.

Тепер AI може за хвилину наплодити:
15 controllers
22 services
repositories
DTO
tests
adapters

і кількість коду перестає бути хорошим способом оцінити складність.

Тому цінність зміщується наверх:
              раніше

Architecture
     ↓
implementation     ← дорого
     ↓
code


               зараз

Architecture       ← найдорожча частина
     ↓
constraints
     ↓
graph
     ↓
AI-generated implementation

Тобто framework майбутнього, на мою думку, повинен оптимізуватися не тільки під developer experience.

Він має бути AI-native в архітектурному сенсі.

Замість того щоб давати AI 400 файлів:

    розберися, як тут усе працює

можна передати:
application.graph

і AI бачить:
83 operations
17 resources
6 DB domains
3 queues
4 external APIs

payments → users
orders → payments
emails ← OrderCreated

і конкретні contracts.

Це на порядки кращий контекст.

І я тут прийшов би до досить радикальної формули:

    Не код є source of truth. І не diagram є source of truth.
    Source of truth — executable architecture graph.

Код реалізує вузли.

UI його візуалізує.

Compiler його аналізує.

Runtime його виконує.

Telemetry накладає на нього фактичний стан.

Deployment compiler ріже його на процеси та bundles.

AI читає його, щоб розуміти систему.

І тоді ця штука вже перестає бути просто Node.js framework. Це скоріше середовище проєктування, виконання й спостереження за backend-системою, де Node.js — лише runtime.

Я б саме в цей бік розвивав ідею. І це, на мій погляд, набагато цікавіше, ніж намагатися зробити «Fastify ще на 15% швидше».
ще виникла у мене ідея стенду. стенд є частиною пакету і може бути тестовим генератором запитів, тестів, замірів. перегляд графу відкриваєм відразу на стенді.

Так. І це, на мою думку, дуже природно замикає всю концепцію. Я б навіть зробив stand не додатковим devtool, а офіційним інтерфейсом фреймворку для взаємодії із системою.

Тобто після:

npx framework dev

у тебе запускається застосунок і одразу:
http://localhost:7000       → application
http://localhost:7001       → Stand

І розробник значну частину часу взагалі може не лазити по Postman, Swagger, Grafana, k6, логах і купі окремих інструментів.
Я б розділив Stand на кілька режимів
┌──────────────────────────────────────────────────────────┐
│ STAND                                                    │
│                                                          │
│ Graph │ Requests │ Tests │ Load │ Traces │ DB │ Events  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                 живий граф системи                       │
│                                                          │
└──────────────────────────────────────────────────────────┘

Причому Graph — головний екран, а все інше відкривається з нього.

Наприклад ти бачиш:
HTTP
 │
 ▼
CreateOrder
 ├────────► PostgreSQL
 │
 ├────────► Stripe
 │
 └────────► OrderCreated
                  │
                  ▼
             MailWorker

Клікаєш CreateOrder.

І справа відкривається:
CreateOrder

POST /orders

Input
─────
userId: uuid
items: OrderItem[]

Output
──────
Order

Dependencies
────────────
CurrentUser
OrdersRepository
PaymentGateway

Errors
──────
INVALID_ORDER
OUT_OF_STOCK
PAYMENT_FAILED

Runtime
───────
requests/min     183
p50              14 ms
p95              41 ms
errors           0.8%

А нижче:
[ Run ] [ Test ] [ Load Test ] [ Trace ] [ Mock ]

Тобто сам граф стає IDE для backend.
Генератор запитів

Через contract framework уже знає input:

input: schema({
    productId: uuid(),
    quantity: int().min(1).max(100),
    coupon: string().optional()
})

Тому Stand автоматично створює форму:
CreateOrder

productId
[______________________]

quantity
[  1  ]

coupon
[______________________]

             [ Run ]

Але я б пішов далі.

Кнопка:
Generate valid input

сама генерує:

{
  "productId": "a4f5...",
  "quantity": 3,
  "coupon": "TEST20"
}

І ще:
Generate edge case
Generate invalid input
Generate random
Із schema автоматично народжується fuzz testing

Наприклад:

age: int().min(18).max(100)

Stand генерує:
17
18
19
99
100
101
0
-1
MAX_INT
null
string
NaN

Для:

name: string().min(2).max(100)

генерується:
""
"a"
"ab"
100 chars
101 chars
unicode
emoji
control chars

Тобто contract одночасно стає джерелом для property-based testing.
А кнопка Test могла б створити testcase

Наприклад ти руками виконав:
POST /orders

input:
{
  productId: "...",
  quantity: 2
}

response:
201

і натискаєш:
Save as test

Framework створює щось на кшталт:

test(CreateOrder)
  .input({
    productId: '...',
    quantity: 2
  })
  .expect({
    status: 'ok'
  })

Або тест зберігається безпосередньо в Architecture IR, без необхідності навіть вручну писати .test.ts.

Тобто стенд може бути тестовим конструктором.
Ще сильніше — record → test

Припустимо в dev ти зробив реальний сценарій:
login
 ↓
create cart
 ↓
add product
 ↓
checkout

Stand бачить trace.

Кнопка:
Save scenario

і отримуємо:
Checkout scenario

1 POST /login
2 POST /cart
3 POST /cart/items
4 POST /checkout

Після цього:

framework test scenario:checkout

відтворює весь потік.

Це вже інтеграційний тест, створений практично без коду.
Load generator теж повинен бути частиною Stand

Клікаємо:
CreateOrder → Load Test

і отримуємо:
Requests/sec
[ 100 ]

Duration
[ 60 sec ]

Concurrency
[ 30 ]

Input
○ fixed
● generated
○ dataset

[ Start ]

І найважливіше: ми не просто отримуємо:
12,483 req/s

а бачимо навантаження безпосередньо на графі.
                 6000 rpm
                   │
                   ▼
              CreateOrder
               p95 31ms
              /          \
        5800 qpm        6000 calls
           ↓                ↓
       PostgreSQL         Redis
       pool 84%           31%

Можна буквально побачити момент, де система починає ламатися.

Наприклад піднімаємо:
100 req/s
200
300
400
500

і на 430:
Postgres pool

█ █ █ █ █ █ █ █ █ ░

92%

WAIT TIME
1 ms → 14 ms

Тоді bottleneck очевидний.
Ще краще — автоматичний пошук межі

Кнопка:
Find breaking point

Stand сам робить щось на кшталт binary/adaptive load testing:
100 rps    OK
200 rps    OK
400 rps    OK
800 rps    FAIL
600 rps    OK
700 rps    warning
650 rps    OK
675 rps    warning

і видає:
Estimated sustainable load

~652 req/sec

Limiting resource:
PostgreSQL connection pool

At 650 req/sec:
CPU              54%
Memory            38%
DB pool           94%
Redis             27%
Event loop lag    8ms

Оце вже набагато корисніше, ніж просто benchmark framework.
І можна тестувати не лише HTTP

Це принципово.

Оскільки центральна сутність — operation, Stand може запускати прямо її:
HTTP mode
Operation mode

HTTP mode:
POST /orders
    ↓
routing
parsing
auth
operation
serialization

Operation mode:
CreateOrder(...)

І одразу можна порівнювати:
HTTP total          8.3 ms
framework overhead  0.7 ms
operation            7.6 ms

Це дуже корисний measurement.
Те саме для worker

Наприклад є:
ImageProcessor

клікаєш:
Generate 10,000 jobs

і бачиш:
QUEUE

████████████████████████ 10,000
██████████████            6,121
██████                    2,331
██                          712

workers: 8
throughput: 184 jobs/s

CPU: 77%
RAM: 1.4 GB

estimated drain:
3.8 sec

Тобто Stand тестує всю execution architecture, не лише API.
Дуже крутим був би Failure Injection

Оце я точно туди додав би.

На графі:
CreateOrder
     │
     ▼
PostgreSQL

правий клік по PostgreSQL:
Inject failure

○ +100ms latency
○ +500ms latency
○ 10% errors
○ 50% errors
○ disconnect
○ timeout

І бачимо:
Postgres OFFLINE

CreateOrder       FAIL
GetOrders         FAIL
UserLogin         OK
SendEmail         OK

Тобто chaos testing стає буквально:

    ткнув у вузол → відключив.

Або Stripe
Stripe

[ simulate ]

latency: 3 seconds
error rate: 20%

І дивимося:
HTTP
 ↓
Checkout
 ↓
Stripe  !!! 3 sec
 ↓
request backlog
 ↓
concurrency 1240
 ↓
memory ↑

Це вже дозволяє навчатися поведінці власної системи.
Ще одна важлива річ — Data Stand

Клікаєш:
UsersRepository

і бачиш:
UsersRepository

operations:

findById     823/min
findByEmail  211/min
save          49/min

PostgreSQL table:
users

queries
indexes
average latency
slow queries

Можна:
Run query trace
Explain
Generate test data
Reset test data

Звичайно, production permissions тут мають бути жорсткими.
Я б навіть зробив environments

Вгорі:
Environment:

[ Local ▼ ]

варіанти:
Local
Test
Staging
Production

Граф той самий.

А дані різні.

Наприклад:
LOCAL

CreateOrder
12 rpm
p95 8 ms
PRODUCTION

CreateOrder
8.3k rpm
p95 47 ms

Архітектура одна, але її реальна поведінка різна.
І це дає дуже круту можливість compare
Compare:

Local
vs
Production

Наприклад:
             local       production

CreateOrder    8ms          41ms
Postgres       2ms          14ms
Redis          1ms           2ms
Stripe        30ms          31ms

І одразу:

    ага, проблема не Stripe, проблема в DB.

Я б узагалі зробив Stand основною dev-командою

Не:

npm run dev

а:

arc stand

умовно.

Він робить:
compile architecture
       ↓
validate graph
       ↓
start application
       ↓
start observability
       ↓
start test generator
       ↓
start load generator
       ↓
open Stand

І terminal:
ARC Stand

Application     http://localhost:3000
Stand           http://localhost:3100

Operations      47
Resources       13
Routes           31
Workers           4

Architecture    ✓
Contracts       ✓
Dependencies    ✓

Ready.
Причому Stand може знати навіть більше, ніж звичайні APM

Тому що Datadog/Grafana/OpenTelemetry бачать переважно:
що сталося

А наш framework знає:
що МОЖЕ статися
+
що МАЛО статися
+
що реально сталося

Є static graph:
possible architecture

Compile graph:
planned execution

Runtime trace:
actual execution

І можна порівнювати всі три.

Наприклад:
EXPECTED:

CreateOrder
 ├ DB
 └ Events


ACTUAL:

CreateOrder
 ├ DB
 ├ DB
 ├ DB
 ├ DB
 ├ DB
 └ Events

Stand:
⚠ Unexpected runtime behavior

UsersRepository.find
expected calls: ≤1
actual average: 18.4

Possible N+1.

Оце вже справді сильна фішка.

І я б тепер нашу архітектуру сформулював уже як три центральні частини, а не одну:
                    Framework

                       GRAPH
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
       Compiler        Runtime         Stand
          │              │              │
      validate        execute        observe
      optimize        measure        test
      estimate        trace          simulate
      bundle                         benchmark
                                      chaos

Причому Stand тут не сторонній UI.

Він клієнт Architecture Graph.

І, думаю, ти дуже вдало назвав це саме стендом, а не dashboard. Dashboard переважно щось показує. Стенд — це місце, де систему можна запустити, навантажити, зламати, виміряти, дослідити й перевірити.

Це вже виглядає як одна з центральних фішок такого фреймворку.
не памятаю. ми вже вибрали назву для цього фреймворка?

Схоже, остаточної назви ми ще не вибирали. У попередній розмові я використовував ARC як робочу назву — звідси було arc stand і ARC Stand — але це виглядало саме як placeholder, а не як зафіксоване рішення.

І, до речі, ARC сюди дуже непогано лягає, бо можна розшифрувати не лише як architecture, а, наприклад:

ARC — Architecture Runtime Compiler

або

ARC — Application Runtime Graph Compiler

Мені другий варіант навіть більше подобається по суті, хоча сама назва ARC досить загальна.

З урахуванням того, що концепція вже стала чіткішою — Graph + Compiler + Runtime + Stand — я б зараз уже підбирав назву саме навколо цієї ідентичності, а не просто "ще один Node framework".
добре хай буде ARC

Домовились: ARC — назва фреймворку.

І вона реально пасує концепції: коротка, технічна, добре звучить у командах типу arc dev, arc stand, arc graph, arc test. Саму розшифровку можна ще не фіксувати — це вже краще зробити, коли остаточно сформуємо позиціонування ARC.
 