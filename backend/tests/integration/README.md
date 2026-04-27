# Integration tests — Cehta backend

Estos tests ejecutan los endpoints HTTP completos contra un **Postgres real**.
A diferencia de los tests unitarios (que aíslan funciones puras), estos
verifican el wiring completo: routing, dependencies, RBAC, repos, schemas y
SQL.

## Estrategia

- **No usamos testcontainers.** Falla en Windows local sin Docker Desktop y
  añade ~10 s por sesión incluso en CI. En su lugar exigimos que ya exista un
  Postgres alcanzable.
- **Schema:** se carga `db/schema.sql` + `db/views.sql` una sola vez por
  sesión (`session` scope). El seed de empresas ya está en `schema.sql`.
- **Aislamiento:** cada test corre en una transacción exterior +
  `SAVEPOINT`. Al terminar se rollbackea todo. Los tests no dependen del
  orden de ejecución.
- **Override:** `tests_client_with_db` reemplaza la dependencia
  `app.api.deps.db_session` por la sesión transaccional del test. Cualquier
  `await db.commit()` dentro del endpoint cierra el SAVEPOINT, no la
  transacción exterior, así seguimos pudiendo hacer rollback.

## Cómo correrlos

### En CI (GitHub Actions)

Ya está configurado en `.github/workflows/backend-ci.yml`. El workflow
levanta un servicio Postgres y exporta `DATABASE_URL`. Los tests se
ejecutan automáticamente vía `pytest`.

### Local con Docker

```bash
docker run -d --name cehta-test-pg \
  -e POSTGRES_USER=cehta -e POSTGRES_PASSWORD=cehta \
  -e POSTGRES_DB=cehta_test -p 55432:5432 postgres:16-alpine

export TEST_DATABASE_URL=postgresql+asyncpg://cehta:cehta@localhost:55432/cehta_test
cd backend
pytest tests/integration -v
```

### Local con Postgres ya instalado

```bash
createdb cehta_test
export TEST_DATABASE_URL=postgresql+asyncpg://localhost/cehta_test
pytest tests/integration -v
```

### Sin Postgres disponible

Los tests se **skipean** con un mensaje claro. Los tests de unit y los de
integración que no tocan DB (auth, validate) se siguen ejecutando.

## Variables de entorno

| Variable                       | Descripción                                                                 |
| ------------------------------ | --------------------------------------------------------------------------- |
| `TEST_DATABASE_URL`            | (preferido) URL de Postgres dedicada para tests.                            |
| `DATABASE_URL`                 | Fallback. Sólo se usa si estamos en CI (`GITHUB_ACTIONS=true`) o con el flag |
| `ALLOW_DB_TESTS_ON_DEFAULT=1`  | Permite usar `DATABASE_URL` localmente. **CUIDADO:** apunta a Supabase prod en `.env`. |

Si ningún URL es resoluble, los tests se skipean — nunca corren contra prod
por accidente.

## Fixtures expuestas

- `test_client` — cliente HTTP sin override de DB (auth/validate).
- `test_client_with_db` — cliente con `db_session` overrideado (CRUD).
- `db_session` — sesión SQLAlchemy transaccional (acceso directo si querés
  preparar fixtures con SQL).
- `auth_headers`, `finance_headers`, `viewer_headers` — JWTs firmados con
  `SUPABASE_JWT_SECRET=test-secret` (matchea el conftest top-level).
