# WooCommerce Excel Price Sync

A standalone Python CLI that matches a Persian Excel product catalog to
WooCommerce, updates regular prices, creates missing products as drafts, and
writes a row-level Excel audit report.

The default mode is a read-only dry-run. Existing sale prices,
descriptions, images, and publication states are not changed.
Stock status is updated only when the workbook includes a `stock?` column.

## Requirements

- Python 3.11 or newer
- A WooCommerce REST API key with read/write product permissions

## Install

```powershell
cd integrations\woocommerce-price-sync
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
```

Edit `.env` with the store URL and API credentials:

```dotenv
WC_URL=https://shop.example.com
WC_CONSUMER_KEY=ck_...
WC_CONSUMER_SECRET=cs_...
WC_TIMEOUT_SECONDS=30
WC_VERIFY_SSL=true
WC_MAX_RETRIES=3
```

Never commit `.env`. The repository ignores it.

## Workbook format

The first worksheet must contain these headers:

- `کد کالا`: product or variation SKU
- `شناسه کالا`: parent code for variation rows
- `نام کالا`: product title
- `تنوع`: variation attribute name
- `مقدار تنوع`: variation attribute value
- `قیمت`: regular price, written to WooCommerce unchanged
- `stock?` (optional): stock status marker for simple products and variations

Rows with both a variation attribute and value are variations. Codes referenced
by those rows are variable parents; remaining rows with a price are simple products.

### Stock status (`stock?`)

When the workbook includes a `stock?` column, the sync updates WooCommerce
`stock_status` for simple products and variations only (not variable parents).
The `موجودی` quantity column is ignored.

- `0` → `outofstock`
- any other value (including empty) → `instock`

If the column is missing entirely, stock status is left unchanged on the site.

The same SKU may appear on both a variation row and a parent row in the source
file. Run the cleaner below before syncing if you want unique SKUs in Excel.

### Clean the Excel first (recommended)

```powershell
.\.venv\Scripts\python.exe -m woocommerce_price_sync.excel_fix `
  "C:\Users\User\Desktop\Site\products_variable_fixed.xlsx" `
  -o "C:\Users\User\Desktop\Site\products_variable_fixed_cleaned.xlsx"
```

This fixes misplaced SKUs, keeps one parent row per variable product, removes
junk duplicate rows, and assigns new unique SKUs to conflicting variation rows.
Open the `FixLog` sheet in the cleaned file to review every change.

## Run

First perform a dry-run:

```powershell
woocommerce-price-sync "C:\Users\User\Desktop\Site\products_variable_fixed.xlsx"
```

This reads WooCommerce but performs no API writes. It creates a timestamped
`*_sync_report_*.xlsx` beside the input file. Use `--output` to choose another
path:

```powershell
woocommerce-price-sync .\products.xlsx --output .\price-sync-report.xlsx
```

Review the `Summary` and `Results` sheets, then apply:

```powershell
.\.venv\Scripts\python.exe -m woocommerce_price_sync.cli `
  "C:\Users\User\Desktop\Site\products_variable_fixed.xlsx" `
  --output "C:\Users\User\Desktop\Site\products_variable_fixed_applied.xlsx" `
  --apply
```

`--apply` is a flag (no value). Put it **after** `--output`, not as the report path.

While it runs you will see timed workflow steps and a progress bar, for example:

```text
[  0.1s] Starting APPLY (writes to WooCommerce)
[  0.2s] 1/5 Reading Excel workbook...
[  3.0s] 2/5 Loading WooCommerce settings...
[  3.1s] 3/5 Fetching WooCommerce catalog (this can take several minutes)...
[ 45.0s] Matching Excel products: [##########----------] 900/1857 ( 48.5%)
[120.0s] 4/5 Writing audit report...
[121.0s] 5/5 Done
```

Large catalogs are slow because every create/update is one WooCommerce API call.
Expect many minutes for thousands of rows. Do not close the window until you see `5/5 Done`.

Use a different environment file with `--env-file C:\secure\store.env`.

## Matching and safety

Matching uses **product titles only**. WooCommerce SKUs are never used for
matching because they differ from the Excel `کد کالا` codes.

Simple and variable parent products:

1. **Exact normalized title**
2. **Fuzzy title** when enabled (default threshold `0.88`, configurable)

Variations:

1. **Exact attribute name + value** under the matched parent
2. **Fuzzy attribute** matching under the parent
3. **Title + variation value** fuzzy match against top-level catalog products
   only when a variation row has no processed parent group
4. **Title-only** fuzzy match as the same orphan fallback

Fuzzy matching uses character similarity and token overlap, which helps when
Excel and the site titles differ slightly (punctuation, spacing, minor wording).

- Normalization handles Unicode compatibility, Arabic/Persian yeh and kaf,
  zero-width characters, case, and repeated whitespace.
- If more than one WooCommerce product has the same normalized title, **all**
  matching products are updated with the Excel price/stock values.
- If Excel defines a variable product but WooCommerce has a simple product with
  the same title, the tool converts that product to `variable`, adds attributes,
  and creates or updates its variations on that same product.
- Matched simple products and variations receive only a `regular_price` update
  (and `stock_status` when the workbook has a `stock?` column).
- Missing simple products, variable parents, and variations are created as
  drafts. A variable parent's attributes are extended only when required to
  create a missing variation.
- Each row is isolated: a failed API operation is logged and later rows continue.

Configure matching in `.env`:

```dotenv
WC_FUZZY_THRESHOLD=0.88
WC_ENABLE_FUZZY=true
```

Or pass `--no-fuzzy` / `--fuzzy-threshold 0.9` on the CLI.

## Product descriptions (automation)

Price sync does not write descriptions. To generate descriptions with a custom
prompt, use one of these approaches:

### Option A: Cursor Automation (no code)

1. Run a dry-run sync and keep the report (`Results` sheet lists matched
   `woo_product_id` values and titles).
2. In Cursor, open **Automations** and create a workflow triggered manually or
   on a schedule.
3. Use a prompt like:

   > For each WooCommerce product in site `{store}`, write a Persian product
   > description from the title `{title}`. Use tone: professional, 2 short
   > paragraphs, mention usage tips. Output HTML only.

4. Loop over products from the sync report or export a CSV of
   `woo_product_id,title` and pass it to the automation.

### Option B: Extend this tool (script)

Add a second command that:

1. Reads the sync report or Excel titles.
2. Calls your LLM API with your prompt template.
3. Writes `description` via `PUT /wp-json/wc/v3/products/{id}`.

That is not built yet; say if you want it added to `woocommerce-price-sync`.

### Option C: Built-in description generator

Generate Persian HTML descriptions (short, long, infographic, table, FAQ) from the
sync report or catalog:

```powershell
generate-descriptions --limit 20
```

- Reads `data/sync-report.xlsx` (`Results` sheet) when available.
- Falls back to `data/catalog.xlsx` parent/simple products when the sync report is empty.
- Skips titles already present in `data/descriptions-report.xlsx`.
- Writes/merges output to `data/descriptions-report.xlsx`.

List pending products without generating:

```powershell
description-product --limit 20
```

Researched product facts live in `description_product_data.py`. Other products
use category-aware fallback content based on the title (cosmetics, supplements,
fragrance, etc.). Expand `PRODUCT_FACTS` over time for higher-quality copy.

The report actions are `unchanged`, `would_update`, `updated`, `would_create`,
`created`, `would_convert`, `converted`, `ambiguous`, and `error`. A run exits
with code `1` if row-level errors occurred and code `2` for configuration or
fatal API errors.

## Tests

```powershell
python -m pytest
```

Tests use fake WooCommerce responses and never contact a live store.
