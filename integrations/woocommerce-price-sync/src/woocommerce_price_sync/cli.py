from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

from .config import ConfigurationError, Settings
from .excel import read_products
from .progress import ProgressReporter
from .report import default_report_path, summarize, write_report
from .sync import PriceSync
from .woo import WooCommerceClient, WooCommerceError


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Match an Excel catalog to WooCommerce and sync regular prices.",
    )
    parser.add_argument("input", type=Path, help="Path to the source .xlsx workbook")
    parser.add_argument("-o", "--output", type=Path, help="Path for the audit .xlsx report")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes to WooCommerce (default is a read-only dry-run)",
    )
    parser.add_argument(
        "--no-fuzzy",
        action="store_true",
        help="Disable fuzzy title matching (exact normalized title only)",
    )
    parser.add_argument(
        "--fuzzy-threshold",
        type=float,
        help="Minimum fuzzy match score from 0 to 1 (default: 0.88 or WC_FUZZY_THRESHOLD)",
    )
    parser.add_argument("--env-file", type=Path, help="Optional environment file")
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    progress = ProgressReporter()

    if args.env_file:
        if not args.env_file.is_file():
            print(f"Environment file not found: {args.env_file}", file=sys.stderr)
            return 2
        load_dotenv(args.env_file)
    else:
        load_dotenv()

    try:
        mode = "APPLY (writes to WooCommerce)" if args.apply else "DRY-RUN (read-only)"
        progress.step(f"Starting {mode}")
        progress.step(f"Input: {args.input}")

        progress.step("1/5 Reading Excel workbook...")
        workbook = read_products(args.input)
        progress.note(
            f"Excel loaded: {len(workbook.products)} products, {len(workbook.issues)} invalid rows"
        )

        progress.step("2/5 Loading WooCommerce settings...")
        settings = Settings.from_env()
        progress.note(f"Store URL: {settings.base_url}")

        def on_woo_progress(label: str, current: int, total: int | None) -> None:
            if total is None:
                progress.note(f"{label} (page {current})")
            else:
                progress.progress(current, total, label)

        client = WooCommerceClient(settings, on_progress=on_woo_progress)

        progress.step("3/5 Fetching WooCommerce catalog (this can take several minutes)...")

        def on_sync_progress(current: int, total: int, label: str) -> None:
            progress.progress(current, total, label)

        results = PriceSync(
            client,
            apply=args.apply,
            on_progress=on_sync_progress,
            fuzzy_threshold=args.fuzzy_threshold
            if args.fuzzy_threshold is not None
            else settings.fuzzy_threshold,
            enable_fuzzy=not args.no_fuzzy and settings.enable_fuzzy,
        ).run(workbook)

        progress.step("4/5 Writing audit report...")
        output = args.output or default_report_path(args.input)
        report_path = write_report(
            output,
            results,
            apply=args.apply,
            input_path=args.input,
        )

        progress.step("5/5 Done")
    except (ConfigurationError, FileNotFoundError, ValueError, WooCommerceError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nCancelled by user.", file=sys.stderr)
        return 130

    summary = summarize(results, apply=args.apply)
    print()
    print(f"Mode: {summary.mode}")
    print(f"Rows: {summary.total_rows}")
    for action, count in summary.action_counts.items():
        print(f"{action}: {count}")
    print(f"Report: {report_path}")
    if not args.apply:
        print("No WooCommerce data was changed. Re-run with --apply after reviewing the report.")
    else:
        print("Changes were written to WooCommerce. Review the report for created/updated/errors.")
    return 0 if summary.action_counts.get("error", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
