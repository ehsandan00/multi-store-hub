from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from .description_product import (
    ProductDescription,
    ProductFacts,
    build_description,
    default_paths,
    load_pending_products,
    merge_descriptions,
    read_descriptions_report,
    write_descriptions_report,
)
from .description_product_data import PRODUCT_FACTS, get_facts_for_product
from .web_research import WebResearchCache, enrich_facts_from_web, purge_empty_cache_entries


CATEGORY_HINTS: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"مولتی.?ویتامین|ویتامین|مکمل|کپسول|قرص|tablet|capsule", re.I), "مکمل غذایی", "قرص"),
    (re.compile(r"کرم|آبرسان|مرطوب|سرم|تونر|ماسک|لوسیون|ژل", re.I), "مراقبت پوست", "کرم"),
    (re.compile(r"شامپو|نرم.?کننده|ماسک مو", re.I), "مراقبت مو", "شامپو"),
    (
        re.compile(
            r"عطر|ادو|پرفیوم|perfume|cologne|eau de|davidoff|dior|chanel|ysl|"
            r"lancome|hugo boss|calvin klein|versace|armani|burberry|gucci|"
            r"baccarat|creed|tom ford|montblanc|azzaro|lacoste",
            re.I,
        ),
        "عطر",
        "ادو پرفیوم",
    ),
    (re.compile(r"ریمل|خط چشم|پودر|کرم پودر|لیپ", re.I), "آرایشی", "محصول آرایشی"),
]


def detect_category(title: str) -> tuple[str, str]:
    for pattern, product_type, form in CATEGORY_HINTS:
        if pattern.search(title):
            return product_type, form
    return "مراقبت و زیبایی", "محصول"


def extract_brand(title: str) -> str:
    latin = re.findall(r"[A-Za-z][A-Za-z0-9&.'\- ]{1,30}", title)
    if latin:
        return latin[-1].strip()
    return ""


def build_fallback_facts(title: str, code: str = "", woo_product_id: str | int | None = None) -> ProductFacts:
    product_type, form = detect_category(title)
    brand = extract_brand(title)
    volume_match = re.search(r"(\d+)\s*(میل|ml|گرم|g|عدد)", title, re.I)
    volume = volume_match.group(0) if volume_match else ""

    if product_type == "مکمل غذایی":
        return ProductFacts(
            title=title,
            code=code,
            woo_product_id=woo_product_id,
            brand=brand,
            product_type=product_type,
            form=form,
            volume=volume,
            summary=f"{title} مکملی حرفه‌ای برای پشتیبانی از نیازهای تغذیه‌ای روزانه است.",
            main_uses=["تأمین ریزمغذی‌ها", "حفظ انرژی روزانه", "پشتیبانی از سلامت عمومی"],
            benefits=[
                ("فرمول متعادل", "ترکیبی از ویتامین‌ها و مواد معدنی برای روتین روزانه."),
                ("مصرف آسان", "قابل استفاده در برنامه غذایی منظم."),
                ("کیفیت قابل اعتماد", "مناسب افرادی که به مکمل روزانه نیاز دارند."),
            ],
            ingredients=[
                ("ویتامین‌ها", "طبق فرمول محصول", "—"),
                ("مواد معدنی", "طبق فرمول محصول", "—"),
            ],
            usage_steps=[
                "طبق دستور روی بسته‌بندی یا توصیه متخصص مصرف کنید.",
                "همراه با آب کافی و ترجیحاً همراه غذا میل شود.",
                "از مصرف بیش از حد مجاز خودداری کنید.",
            ],
            suitable_for=["افراد بالغ", "کسانی با رژیم ناقص", "روتین سلامت روزانه"],
            cautions=["در بارداری و شیردهی با پزشک مشورت کنید.", "دور از دسترس کودکان نگهداری شود."],
            quick_facts=[
                ("نوع", product_type),
                ("فرم", form),
                ("برند", brand or "—"),
                ("حجم/تعداد", volume or "طبق بسته"),
            ],
            faq=[
                ("روش مصرف چیست؟", "طبق دستور روی بسته‌بندی مصرف شود."),
                ("آیا نیاز به مشورت پزشک دارد؟", "در صورت بیماری یا مصرف دارو، با پزشک مشورت کنید."),
            ],
        )

    if product_type == "عطر":
        return ProductFacts(
            title=title,
            code=code,
            woo_product_id=woo_product_id,
            brand=brand,
            product_type=product_type,
            form=form,
            volume=volume,
            summary=f"{title} عطری لوکس با رایحه‌ای ماندگار و شخصیتی متمایز است.",
            main_uses=["عطر روزانه", "مناسب مهمانی", "هدیه لوکس"],
            benefits=[
                ("ماندگاری مناسب", "رایحه‌ای پایدار برای استفاده روزانه یا شبانه."),
                ("شخصیت بویایی", "ترکیبی از نت‌های گرم و ظریف."),
                ("جلوه لوکس", "انتخابی مناسب برای علاقه‌مندان به عطرهای خاص."),
            ],
            ingredients=[
                ("نت آغازین", "ترکیبات معطر روشن", "—"),
                ("نت میانی", "گل‌ها و ادویه‌ها", "—"),
                ("نت پایه", "چوب و کهربا", "—"),
            ],
            usage_steps=[
                "روی نقاط نبض مانند مچ و گردن اسپری کنید.",
                "از مالش شدید پوست پس از اسپری خودداری کنید.",
                "برای ماندگاری بیشتر، روی پوست مرطوب استفاده کنید.",
            ],
            suitable_for=["بانوان و آقایان", "استفاده روزانه و مجلسی"],
            cautions=["از تماس مستقیم با چشم پرهیز کنید.", "دور از گرما و نور مستقیم نگهداری شود."],
            quick_facts=[
                ("نوع", "عطر"),
                ("برند", brand or "—"),
                ("غلظت", form),
            ],
            faq=[
                ("ماندگاری چقدر است؟", "بسته به نوع پوست و آب‌وهوا متفاوت است."),
                ("برای چه فصلی مناسب است؟", "بسته به ترکیب رایحه، مناسب فصول مختلف است."),
            ],
        )

    return ProductFacts(
        title=title,
        code=code,
        woo_product_id=woo_product_id,
        brand=brand,
        product_type=product_type,
        form=form,
        volume=volume,
        summary=f"{title} انتخابی حرفه‌ای برای تکمیل روتین مراقبتی روزانه است.",
        main_uses=["مراقبت روزانه", "حفظ سلامت ظاهری", "تقویت روتین زیبایی"],
        benefits=[
            ("مراقبت موثر", "کمک به حفظ ظاهر سالم و متعادل."),
            ("بافت مناسب", "قابل استفاده در روتین صبح یا شب."),
            ("فرمول قابل اعتماد", "مناسب استفاده منظم."),
        ],
        ingredients=[
            ("ترکیبات فعال", "طبق فرمول محصول", "—"),
            ("مرطوب‌کننده‌ها", "پشتیبانی از رطوبت پوست", "—"),
        ],
        usage_steps=[
            "روی پوست تمیز و خشک استفاده کنید.",
            "مقدار مناسب را به‌صورت یکنواخت پخش کنید.",
            "صبح و شب در روتین مراقبتی تکرار کنید.",
        ],
        suitable_for=["انواع پوست با توجه به نوع محصول", "روتین روزانه"],
        cautions=["از تماس با چشم پرهیز کنید.", "در صورت حساسیت مصرف را متوقف کنید."],
        quick_facts=[
            ("نوع", product_type),
            ("فرم", form),
            ("برند", brand or "—"),
        ],
        faq=[
            ("چند بار در روز استفاده شود؟", "معمولاً یک تا دو بار در روز کافی است."),
            ("قبل از آرایش قابل استفاده است؟", "پس از جذب کامل، زیر آرایش نیز مناسب است."),
        ],
    )


def generate_description_for_product(
    title: str,
    code: str = "",
    woo_product_id: str | int | None = None,
    *,
    web_cache: WebResearchCache | None = None,
    web_search: bool = True,
) -> ProductDescription:
    if title in PRODUCT_FACTS:
        facts = get_facts_for_product(title, code=code, woo_product_id=woo_product_id)
        notes = "researched-facts"
    else:
        facts = build_fallback_facts(title, code=code, woo_product_id=woo_product_id)
        facts = enrich_facts_from_web(facts, cache=web_cache, enabled=web_search)
        notes = facts.category_hint or "category-fallback"
    description = build_description(facts)
    description.notes = notes
    return description


def run_batch(
    *,
    catalog: Path | None = None,
    output: Path | None = None,
    limit: int | None = 20,
    web_search: bool = True,
    save_every: int = 25,
    refresh_fallbacks: bool = False,
    force: bool = False,
) -> Path:
    _, catalog_path, output_path = default_paths()
    catalog = catalog or catalog_path
    output = output or output_path

    web_cache = WebResearchCache()
    if web_search:
        purge_empty_cache_entries(web_cache)

    pending = load_pending_products(
        catalog=catalog,
        descriptions_report=output,
        limit=limit,
        refresh_fallbacks=refresh_fallbacks,
        force=force,
    )
    if not pending:
        return output

    existing = {} if force else (read_descriptions_report(output) if output.is_file() else {})
    generated: list[ProductDescription] = []

    for index, product in enumerate(pending, start=1):
        generated.append(
            generate_description_for_product(
                product.title,
                code=product.code,
                woo_product_id=product.woo_product_id,
                web_cache=web_cache,
                web_search=web_search,
            )
        )
        if save_every > 0 and index % save_every == 0:
            merged = merge_descriptions(existing, generated)
            write_descriptions_report(output, merged, input_path=catalog)
            print(f"Checkpoint: saved {index}/{len(pending)} descriptions", file=sys.stderr)

    merged = merge_descriptions(existing, generated)
    return write_descriptions_report(output, merged, input_path=catalog)


def build_parser() -> argparse.ArgumentParser:
    _, catalog, descriptions_report = default_paths()
    parser = argparse.ArgumentParser(
        description="Generate Persian WooCommerce product descriptions from catalog.xlsx.",
    )
    parser.add_argument(
        "--catalog",
        type=Path,
        default=catalog,
        help="Path to catalog.xlsx (parent + simple products only)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=descriptions_report,
        help="Path for descriptions-report.xlsx",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Maximum pending products to generate (0 = all pending)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Generate descriptions for all pending products in catalog",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate all products and replace existing output rows",
    )
    parser.add_argument(
        "--no-web-search",
        action="store_true",
        help="Skip DuckDuckGo web research enrichment",
    )
    parser.add_argument(
        "--refresh-fallbacks",
        action="store_true",
        help="Regenerate category-fallback descriptions with web research",
    )
    parser.add_argument(
        "--save-every",
        type=int,
        default=25,
        help="Write checkpoint every N products (0 disables checkpoints)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    limit = None if args.all or args.limit == 0 else args.limit
    report_path = run_batch(
        catalog=args.catalog,
        output=args.output,
        limit=limit,
        web_search=not args.no_web_search,
        save_every=args.save_every,
        refresh_fallbacks=args.refresh_fallbacks,
        force=args.force,
    )
    existing = read_descriptions_report(report_path)
    print(f"Descriptions report written to: {report_path}")
    print(f"Total descriptions in report: {len(existing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
