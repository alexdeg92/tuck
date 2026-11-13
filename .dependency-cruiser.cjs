/**
 * Architecture rules from docs/ARCHITECTURE.md, enforced in CI by `npm run check:arch`.
 * Dependencies point inward: http -> application -> domain; infrastructure implements
 * application ports. Modules reach each other only through their application index.
 */
const API = '^apps/api/src';
const WEB = '^apps/web/src';
const MODULE = `${API}/modules/([^/]+)`;
/** Entry points and wiring: app.ts (composition root), server.ts (process entry), seed.ts, storage.ts. */
const COMPOSITION_ROOTS = `${API}/(app|server|seed|storage)\\.ts$`;
/** Frameworks and I/O drivers, wherever npm installed them (root or workspace node_modules). */
const FRAMEWORKS =
  '(^|/)node_modules/(express|better-sqlite3|pg|jose|helmet|express-rate-limit|cookie-parser)/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'not-to-unresolvable',
      comment: 'An unresolved import would silently escape every rule below.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'api-domain-is-pure',
      comment: 'Domain code imports only its own domain, the contracts and pure libraries.',
      severity: 'error',
      from: { path: `${MODULE}/domain/` },
      to: {
        pathNot: [
          `${API}/modules/$1/domain/`,
          '^packages/contracts/',
          '(^|/)node_modules/(zod|fractional-indexing)/',
        ],
      },
    },
    {
      name: 'api-application-no-outer-layers',
      comment: 'Use cases depend on domain and ports, never on adapters, routes or frameworks.',
      severity: 'error',
      // Tests are their own composition root: a use-case test may wire in the memory adapter.
      from: { path: `${MODULE}/application/`, pathNot: '\\.test\\.ts$' },
      to: {
        path: [
          `${API}/modules/[^/]+/(infrastructure|http)/`,
          `${API}/shared/(http|db)/`,
          COMPOSITION_ROOTS,
          FRAMEWORKS,
        ],
      },
    },
    {
      name: 'api-infrastructure-not-to-http',
      severity: 'error',
      from: { path: `${MODULE}/infrastructure/` },
      to: { path: [`${API}/modules/[^/]+/http/`, `${API}/shared/http/`] },
    },
    {
      name: 'api-http-not-to-infrastructure',
      comment: 'Routes parse, call one use case and map the result; they never touch adapters.',
      severity: 'error',
      from: { path: `${MODULE}/http/` },
      to: { path: [`${API}/modules/[^/]+/infrastructure/`, `${API}/shared/db/`] },
    },
    {
      name: 'api-modules-talk-through-application-index',
      comment:
        "A module reaches another only through its application index. Tests are their own composition root: a test may build another module's adapter as a fixture.",
      severity: 'error',
      from: { path: `${MODULE}/`, pathNot: '\\.test\\.ts$' },
      to: {
        path: `${API}/modules/`,
        pathNot: [`${API}/modules/$1/`, `${API}/modules/[^/]+/application/index\\.ts$`],
      },
    },
    {
      name: 'api-tasks-is-the-base-module',
      comment:
        'Feature modules depend in one direction: search -> checklists -> tasks (-> notes). Tasks knows neither checklists nor search.',
      severity: 'error',
      from: { path: `${API}/modules/tasks/`, pathNot: '\\.test\\.ts$' },
      to: { path: `${API}/modules/(checklists|search)/` },
    },
    {
      name: 'api-notes-stands-alone',
      comment: 'Notes (formatted note rules) is pure: tasks uses it, it uses no feature module.',
      severity: 'error',
      from: { path: `${API}/modules/notes/`, pathNot: '\\.test\\.ts$' },
      to: { path: `${API}/modules/(auth|tasks|checklists|search)/` },
    },
    {
      name: 'api-checklists-not-to-search',
      comment: 'Search reads checklists, never the reverse.',
      severity: 'error',
      from: { path: `${API}/modules/checklists/`, pathNot: '\\.test\\.ts$' },
      to: { path: `${API}/modules/search/` },
    },
    {
      name: 'api-auth-not-to-features',
      comment:
        'Auth stands alone: the feature modules use it (through the session), not the reverse.',
      severity: 'error',
      from: { path: `${API}/modules/auth/` },
      to: { path: `${API}/modules/(tasks|checklists|search)/` },
    },
    {
      name: 'api-shared-not-to-modules',
      severity: 'error',
      from: { path: `${API}/shared/` },
      to: { path: [`${API}/modules/`, COMPOSITION_ROOTS] },
    },
    {
      name: 'api-modules-not-to-composition-roots',
      comment: 'Wiring depends on modules, never the reverse.',
      severity: 'error',
      from: { path: `${API}/modules/` },
      to: { path: COMPOSITION_ROOTS },
    },
    {
      name: 'web-features-are-isolated',
      severity: 'error',
      from: { path: `${WEB}/features/([^/]+)/` },
      to: { path: `${WEB}/features/`, pathNot: `${WEB}/features/$1/` },
    },
    {
      name: 'web-components-never-fetch',
      comment: 'Components and pages go through hooks, which call the feature api adapter.',
      severity: 'error',
      from: { path: `${WEB}/features/[^/]+/(components|pages)/` },
      to: { path: [`${WEB}/shared/api/`, `${WEB}/features/[^/]+/api\\.ts$`] },
    },
    {
      name: 'web-shared-not-to-features-or-app',
      severity: 'error',
      from: { path: `${WEB}/shared/` },
      to: { path: [`${WEB}/features/`, `${WEB}/app/`] },
    },
    {
      name: 'web-features-not-to-app',
      severity: 'error',
      from: { path: `${WEB}/features/` },
      to: { path: `${WEB}/app/` },
    },
    {
      name: 'apps-do-not-import-each-other',
      severity: 'error',
      from: { path: '^apps/(api|web)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'contracts-stand-alone',
      comment: 'The contracts package depends on Zod only.',
      severity: 'error',
      from: { path: '^packages/contracts/src/' },
      to: { path: '^(apps|e2e)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
