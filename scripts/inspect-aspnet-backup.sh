#!/usr/bin/env bash
set -euo pipefail

container="${MSSQL_CONTAINER:-mssql-check2}"
database="${MSSQL_DATABASE:-MooyeKamandShopDb}"
backup="/backup/backup.bak"
sqlcmd="/opt/mssql-tools18/bin/sqlcmd"

docker start "$container" >/dev/null

sa_password="$(
  docker inspect "$container" \
    --format '{{range .Config.Env}}{{println .}}{{end}}' |
    awk -F= '$1 == "MSSQL_SA_PASSWORD" { sub(/^[^=]*=/, ""); print; exit }'
)"

if [[ -z "$sa_password" ]]; then
  echo "MSSQL_SA_PASSWORD is not configured on $container" >&2
  exit 1
fi

run_sql() {
  docker exec "$container" "$sqlcmd" \
    -S localhost -U sa -P "$sa_password" -C -b "$@"
}

for _ in $(seq 1 60); do
  if run_sql -Q "SET NOCOUNT ON; SELECT 1" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
run_sql -Q "SET NOCOUNT ON; SELECT 1" >/dev/null

db_exists="$(run_sql -h -1 -W -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE name = N'$database'")"
if [[ "${db_exists//[[:space:]]/}" == "0" ]]; then
  run_sql -Q "
    RESTORE DATABASE [$database]
    FROM DISK = N'$backup'
    WITH MOVE N'MooyeKamandShopDb' TO N'/var/opt/mssql/data/${database}.mdf',
         MOVE N'MooyeKamandShopDb_Log' TO N'/var/opt/mssql/data/${database}_log.ldf',
         RECOVERY, REPLACE, STATS = 10;
  "
fi

echo "== Database and compatibility =="
run_sql -d "$database" -W -s "|" -Q "
  SET NOCOUNT ON;
  SELECT DB_NAME() AS database_name,
         compatibility_level
  FROM sys.databases
  WHERE name = DB_NAME();
"

echo "== Product-related tables =="
run_sql -d "$database" -W -s "|" -Q "
  SET NOCOUNT ON;
  SELECT s.name AS schema_name, t.name AS table_name
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  WHERE t.name LIKE '%Product%'
     OR t.name LIKE '%Stock%'
     OR t.name LIKE '%TierPrice%'
     OR t.name LIKE '%Category%'
     OR t.name LIKE '%Version%'
     OR t.name LIKE '%Migration%'
  ORDER BY t.name;
"

echo "== Product columns =="
run_sql -d "$database" -W -s "|" -Q "
  SET NOCOUNT ON;
  SELECT c.column_id, c.name AS column_name, TYPE_NAME(c.user_type_id) AS data_type
  FROM sys.columns c
  WHERE c.object_id = OBJECT_ID(N'dbo.Product')
  ORDER BY c.column_id;
"

echo "== Version evidence =="
run_sql -d "$database" -W -s "|" -Q "
  SET NOCOUNT ON;
  IF OBJECT_ID(N'dbo.MigrationVersionInfo') IS NOT NULL
    SELECT TOP (20) * FROM dbo.MigrationVersionInfo ORDER BY 1 DESC;
  ELSE IF OBJECT_ID(N'dbo.Version') IS NOT NULL
    SELECT TOP (20) * FROM dbo.[Version] ORDER BY 1 DESC;
  ELSE
    SELECT TOP (20) [Name], [Value]
    FROM dbo.Setting
    WHERE [Name] LIKE '%version%'
    ORDER BY [Name];
"

echo "== Store URLs =="
run_sql -d "$database" -W -s "|" -Q "
  SET NOCOUNT ON;
  IF OBJECT_ID(N'dbo.Store') IS NOT NULL
    SELECT Id, Name, Url, Hosts FROM dbo.Store ORDER BY Id;
"

echo "== Schema fingerprints =="
run_sql -d "$database" -W -s "|" -Q "
  SET NOCOUNT ON;
  SELECT t.name AS table_name, c.name AS column_name, TYPE_NAME(c.user_type_id) AS data_type
  FROM sys.tables t
  JOIN sys.columns c ON c.object_id = t.object_id
  WHERE t.name IN (
    N'ProductAttributeCombination',
    N'ProductWarehouseInventory',
    N'StockQuantityHistory',
    N'Picture',
    N'Plugin',
    N'Setting'
  )
  ORDER BY t.name, c.column_id;
"

echo "== Catalog counts =="
run_sql -d "$database" -W -s "|" -Q "
  SET NOCOUNT ON;
  DECLARE @variants bigint = 0;
  IF OBJECT_ID(N'dbo.ProductVariant') IS NOT NULL
    EXEC sp_executesql N'SELECT @value = COUNT(*) FROM dbo.ProductVariant',
                       N'@value bigint OUTPUT', @variants OUTPUT;
  ELSE IF OBJECT_ID(N'dbo.ProductAttributeCombination') IS NOT NULL
    SELECT @variants = COUNT(*) FROM dbo.ProductAttributeCombination;

  SELECT (SELECT COUNT(*) FROM dbo.Product) AS products,
         @variants AS variants,
         (SELECT COUNT(*) FROM dbo.Category) AS categories;
"
