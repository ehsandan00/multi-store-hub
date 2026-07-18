#!/usr/bin/env bash
set -euo pipefail

container="${MSSQL_CONTAINER:-mssql-check2}"
database="${MSSQL_DATABASE:-MooyeKamandShopDb}"
output_dir="${1:-/mnt/c/Users/User/Projects/multi-store-hub/integrations/aspnet-product-sync/discovery/artifacts}"
sqlcmd="/opt/mssql-tools18/bin/sqlcmd"

mkdir -p "$output_dir"
docker start "$container" >/dev/null
sa_password="$(
  docker inspect "$container" \
    --format '{{range .Config.Env}}{{println .}}{{end}}' |
    awk -F= '$1 == "MSSQL_SA_PASSWORD" { sub(/^[^=]*=/, ""); print; exit }'
)"

run_export() {
  local query="$1"
  local output="$2"
  docker exec "$container" "$sqlcmd" \
    -S localhost -U sa -P "$sa_password" -C -b \
    -d "$database" -h -1 -W -s $'\t' -Q "SET NOCOUNT ON; $query" |
    awk 'NF > 0 && $0 !~ /rows affected/' > "$output"
}

run_export "
  SELECT Id,
         REPLACE(REPLACE(ISNULL(Sku, ''), CHAR(9), ' '), CHAR(10), ' ') AS Sku,
         CONVERT(varchar(50), Price) AS Price,
         StockQuantity,
         ProductTypeId,
         CAST(Published AS int) AS Published,
         CAST(Deleted AS int) AS Deleted
  FROM dbo.Product
  ORDER BY Id;
" "$output_dir/products.tsv"

run_export "
  SELECT Id,
         ProductId,
         REPLACE(REPLACE(ISNULL(Sku, ''), CHAR(9), ' '), CHAR(10), ' ') AS Sku,
         COALESCE(CONVERT(varchar(50), OverriddenPrice), '') AS OverriddenPrice,
         StockQuantity
  FROM dbo.ProductAttributeCombination
  ORDER BY Id;
" "$output_dir/product-combinations.tsv"

run_export "
  SELECT Id,
         ParentCategoryId,
         REPLACE(REPLACE(Name, CHAR(9), ' '), CHAR(10), ' ') AS Name,
         CAST(Published AS int) AS Published,
         CAST(Deleted AS int) AS Deleted
  FROM dbo.Category
  ORDER BY Id;
" "$output_dir/categories.tsv"

run_export "
  SELECT ProductId, CategoryId, DisplayOrder
  FROM dbo.Product_Category_Mapping
  ORDER BY ProductId, DisplayOrder, CategoryId;
" "$output_dir/product-category-mappings.tsv"

printf 'Exported product-only catalog to %s\n' "$output_dir"
