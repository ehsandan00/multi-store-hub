from __future__ import annotations

from .description_product import ProductFacts, ProductDescription, build_description

# Researched product facts keyed by exact catalog title.
PRODUCT_FACTS: dict[str, ProductFacts] = {}


def _facts(
    title: str,
    *,
    woo_product_id: str | int | None = None,
    code: str = "",
    brand: str = "",
    product_type: str = "",
    form: str = "",
    volume: str = "",
    count: str = "",
    summary: str = "",
    main_uses: list[str] | None = None,
    benefits: list[tuple[str, str]] | None = None,
    ingredients: list[tuple[str, str, str]] | None = None,
    usage_steps: list[str] | None = None,
    suitable_for: list[str] | None = None,
    cautions: list[str] | None = None,
    quick_facts: list[tuple[str, str]] | None = None,
    faq: list[tuple[str, str]] | None = None,
) -> ProductFacts:
    return ProductFacts(
        title=title,
        woo_product_id=woo_product_id,
        code=code,
        brand=brand,
        product_type=product_type,
        form=form,
        volume=volume,
        count=count,
        summary=summary,
        main_uses=main_uses or [],
        benefits=benefits or [],
        ingredients=ingredients or [],
        usage_steps=usage_steps or [],
        suitable_for=suitable_for or [],
        cautions=cautions or [],
        quick_facts=quick_facts or [],
        faq=faq or [],
    )


def _register(facts: ProductFacts) -> None:
    PRODUCT_FACTS[facts.title] = facts


_register(_facts(
    "A Z مولتی ویتامین بالای 50 سال بانوان",
    code="34376",
    brand="EuRho Vital",
    product_type="مکمل غذایی",
    form="قرص",
    count="45 عدد",
    summary=(
        "مولتی‌ویتامین A-Z یوروویتال فرمولی جامع از ویتامین‌ها، مواد معدنی و "
        "ترکیبات آنتی‌اکسیدانی برای پشتیبانی از سلامت بانوان بالای ۵۰ سال است."
    ),
    main_uses=[
        "تأمین ویتامین‌های روزانه",
        "کمک به سطح انرژی",
        "پشتیبانی از ایمنی و استخوان",
    ],
    benefits=[
        ("تأمین ریزمغذی‌ها", "فرمول کامل ویتامین‌ها و مواد معدنی برای جبران کمبودهای تغذیه‌ای."),
        ("کمک به انرژی روزانه", "ویتامین‌های گروه B در متابولیسم انرژی نقش دارند."),
        ("پشتیبانی آنتی‌اکسیدانی", "حاوی کوآنزیم Q10، لوتئین و عصاره چای سبز."),
        ("سلامت استخوان", "کلسیم و ویتامین D برای حفظ استحکام استخوان."),
    ],
    ingredients=[
        ("ویتامین C", "60 mg", "75%"),
        ("ویتامین D3", "15 mcg", "300%"),
        ("ویتامین E", "15 mg", "125%"),
        ("کلسیم", "247 mg", "31%"),
        ("آهن", "10 mg", "71%"),
        ("روی", "15 mg", "150%"),
        ("کوآنزیم Q10", "20 mg", "—"),
        ("لوتئین", "2 mg", "—"),
    ],
    usage_steps=[
        "روزانه یک قرص همراه با آب و غذا مصرف کنید.",
        "از مصرف بیش از دوز توصیه‌شده خودداری کنید.",
        "برای نتیجه بهتر، مصرف منظم را رعایت کنید.",
    ],
    suitable_for=[
        "بانوان بالای ۵۰ سال",
        "افرادی با رژیم غذایی ناقص",
        "کسانی که به مکمل روزانه نیاز دارند",
    ],
    cautions=[
        "در بارداری و شیردهی با پزشک مشورت کنید.",
        "در صورت مصرف داروهای دیگر، قبل از مصرف اطلاع دهید.",
        "دور از دسترس کودکان نگهداری شود.",
    ],
    quick_facts=[
        ("برند", "EuRho Vital"),
        ("نوع محصول", "مولتی‌ویتامین"),
        ("فرم", "قرص"),
        ("تعداد", "45 عدد"),
        ("گروه سنی", "بالای 50 سال"),
        ("کشور سازنده", "آلمان"),
    ],
    faq=[
        ("روش مصرف چگونه است؟", "روزانه یک قرص با آب و همراه غذا مصرف شود."),
        ("برای چه سنی مناسب است؟", "این فرمول مخصوص بانوان بالای ۵۰ سال طراحی شده است."),
        ("آیا می‌توان همراه دارو مصرف کرد؟", "در صورت بیماری یا مصرف دارو، با پزشک مشورت کنید."),
        ("چه مدت یک بسته کافی است؟", "با مصرف روزانه یک قرص، هر بسته حدود ۴۵ روز دوام دارد."),
    ],
))

_register(_facts(
    "آبرسان ۱۰۰ ساعته مویسچر سرج کلینیک",
    code="VPP-43769",
    brand="Clinique",
    product_type="مراقبت پوست",
    form="ژل-کرم",
    volume="50ml / 125ml",
    summary=(
        "آبرسان Moisture Surge 100H کلینیک با فناوری Auto-Replenishing، رطوبت را تا "
        "۱۰۰ ساعت در پوست حفظ می‌کند و بافتی سبک، بدون چربی و مناسب انواع پوست دارد."
    ),
    main_uses=["آبرسانی عمیق", "استفاده زیر آرایش", "ماسک آبرسان"],
    benefits=[
        ("آبرسانی ۱۰۰ ساعته", "حفظ رطوبت در لایه‌های عمقی پوست حتی پس از شستشو."),
        ("بافت ژل-کرمی سبک", "جذب سریع بدون ایجاد چربی یا سنگینی."),
        ("تقویت سد دفاعی", "کمک به کاهش خشکی، کشیدگی و کدری پوست."),
        ("فرمول پاک", "فاقد پارابن، فتالات و عطر؛ مناسب پوست حساس."),
    ],
    ingredients=[
        ("هیالورونیک اسید", "در دو وزن مولکولی", "—"),
        ("عصاره آلوئه‌ورا", "تسکین و آبرسانی", "—"),
        ("کافئین", "تحریک تولید مجدد رطوبت", "—"),
        ("گلیسیرین", "حفظ رطوبت سطحی", "—"),
    ],
    usage_steps=[
        "صبح و شب مقدار مناسب را روی پوست تمیز صورت و گردن بزنید.",
        "به‌صورت ملایم ماساژ دهید تا جذب شود.",
        "برای ماسک آبرسان، لایه ضخیم‌تر بگذارید و ۵ دقیقه بمانید.",
    ],
    suitable_for=["انواع پوست", "پوست خشک و دهیدراته", "پوست حساس"],
    cautions=["از تماس با چشم پرهیز کنید.", "در صورت تحریک، مصرف را متوقف کنید."],
    quick_facts=[
        ("برند", "Clinique"),
        ("نوع", "آبرسان"),
        ("فناوری", "Auto-Replenishing"),
        ("ماندگاری رطوبت", "تا 100 ساعت"),
        ("بافت", "ژل-کرم"),
    ],
    faq=[
        ("آیا زیر آرایش مناسب است؟", "بله، پس از جذب کامل بافت سبک آن زیر آرایش عالی است."),
        ("برای پوست چرب هم قابل استفاده است؟", "بله، فرمول بدون چربی برای انواع پوست طراحی شده است."),
        ("چند بار در روز استفاده شود؟", "معمولاً صبح و شب؛ در صورت خشکی بیشتر قابل تکرار است."),
    ],
))

_register(_facts(
    "آبرسان پوست خشک بایودرما",
    code="18636",
    brand="Bioderma",
    product_type="مراقبت پوست",
    form="کرم",
    volume="50ml",
    summary=(
        "کرم آبرسان بایودرما با کمپلکس Aquagenium برای پوست خشک و دهیدراته طراحی شده "
        "و به بازآموزی مکانیسم طبیعی آبرسانی پوست کمک می‌کند."
    ),
    main_uses=["آبرسانی عمیق", "تغذیه پوست خشک", "پایه آرایش"],
    benefits=[
        ("آبرسانی ۸ ساعته", "رطوبت ماندگار و احساس نرمی فوری."),
        ("تقویت آکواپورین‌ها", "کمک به انتقال آب در لایه‌های پوست."),
        ("صاف‌کنندگی بافت", "اسید سالیسیلیک به هموار شدن سطح پوست کمک می‌کند."),
        ("محافظت آنتی‌اکسیدانی", "ویتامین E در برابر استرس اکسیداتیو."),
    ],
    ingredients=[
        ("Aquagenium", "کمپلکس اختصاصی", "—"),
        ("اسید سالیسیلیک", "لایه‌برداری ملایم", "—"),
        ("ویتامین E", "آنتی‌اکسیدان", "—"),
        ("مرطوب‌کننده‌ها", "تغذیه پوست خشک", "—"),
    ],
    usage_steps=[
        "صبح و/یا شب روی پوست تمیز صورت و گردن بزنید.",
        "با حرکات دورانی ملایم ماساژ دهید تا جذب شود.",
        "به‌عنوان پایه آرایش قبل از کرم پودر استفاده کنید.",
    ],
    suitable_for=["پوست خشک تا خیلی خشک", "پوست دهیدراته", "پوست حساس"],
    cautions=["از تماس با چشم پرهیز کنید.", "در صورت حساسیت، مصرف را قطع کنید."],
    quick_facts=[
        ("برند", "Bioderma"),
        ("خط", "Hydrabio / Atoderm"),
        ("نوع پوست", "خشک و حساس"),
        ("ماندگاری", "تا 8 ساعت"),
    ],
    faq=[
        ("برای پوست خیلی خشک کافی است؟", "برای خشکی شدید می‌توان همراه سرم آبرسان استفاده کرد."),
        ("غیرکومدوژنیک است؟", "فرمول بایودرما برای پوست حساس و مستعد جوش تست شده است."),
    ],
))

_register(_facts(
    "Baccarat Rouge 540 باکارات رژ",
    code="PC-6963",
    brand="Maison Francis Kurkdjian",
    product_type="عطر",
    form="ادو پرفیوم",
    summary=(
        "باکارات رژ ۵۴۰ اثر فرانسیس کرکجیان، عطری کهربایی-چوبی با نت‌های یاسمن، "
        "زعفران و کهرباگريس است و یکی از شناخته‌شده‌ترین عطرهای لوکس معاصر محسوب می‌شود."
    ),
    main_uses=["عطر مجلسی", "استفاده روزانه لوکس", "هدیه خاص"],
    benefits=[
        ("رایحه ماندگار", "ماندگاری بالا روی پوست و لباس."),
        ("شخصیت کهربایی-گلی", "ترکیبی گرم، شفاف و در عین حال پیچیده."),
        ("جلوه لوکس", "انتخابی شاخص در دسته عطرهای نیش."),
        ("پروژکشن مناسب", "حضور بویایی محسوس در ساعات اول."),
    ],
    ingredients=[
        ("زعفران", "نت آغازین ادویه‌ای", "—"),
        ("یاسمن", "نت گلی روشن", "—"),
        ("کهرباگريس", "نت معدنی-کهربایی", "—"),
        ("چوب سدر", "نت پایه چوبی", "—"),
    ],
    usage_steps=[
        "۲ تا ۳ پاف روی نقاط نبض (مچ، گردن، پشت گوش) اسپری کنید.",
        "از مالش شدید پوست پس از اسپری خودداری کنید.",
        "برای ماندگاری بیشتر، روی پوست مرطوب یا لایه نازک لوسیون بدون بو بزنید.",
    ],
    suitable_for=["بانوان و آقایان", "عاشقان عطرهای کهربایی-گلی"],
    cautions=["از تماس با چشم و زخم باز پرهیز کنید.", "دور از گرما و نور مستقیم نگهداری شود."],
    quick_facts=[
        ("برند", "Maison Francis Kurkdjian"),
        ("غلظت", "Eau de Parfum"),
        ("خانواده بویایی", "کهربایی گلی چوبی"),
        ("پرفیومر", "Francis Kurkdjian"),
    ],
    faq=[
        ("تفاوت EDP و Extrait چیست؟", "EDP شفاف‌تر و روشن‌تر است؛ Extrait غلیظ‌تر و گرم‌تر."),
        ("برای چه فصلی مناسب است؟", "به‌ویژه پاییز و winter؛ در شب و مهمانی عالی است."),
        ("ماندگاری چقدر است؟", "معمولاً ۸ تا ۱۲ ساعت روی پوست و بیشتر روی پارچه."),
    ],
))


def get_facts_for_product(title: str, code: str = "", woo_product_id: str | int | None = None) -> ProductFacts:
    if title in PRODUCT_FACTS:
        facts = PRODUCT_FACTS[title]
        return ProductFacts(
            title=facts.title,
            woo_product_id=woo_product_id or facts.woo_product_id,
            code=code or facts.code,
            brand=facts.brand,
            product_type=facts.product_type,
            form=facts.form,
            volume=facts.volume,
            count=facts.count,
            main_uses=list(facts.main_uses),
            benefits=list(facts.benefits),
            ingredients=list(facts.ingredients),
            usage_steps=list(facts.usage_steps),
            suitable_for=list(facts.suitable_for),
            cautions=list(facts.cautions),
            quick_facts=list(facts.quick_facts),
            faq=list(facts.faq),
            summary=facts.summary,
            category_hint=facts.category_hint,
        )
    return ProductFacts(title=title, code=code, woo_product_id=woo_product_id)


def build_descriptions_for_titles(
    items: list[tuple[str, str, str | int | None]],
) -> list[ProductDescription]:
    descriptions: list[ProductDescription] = []
    for title, code, woo_id in items:
        facts = get_facts_for_product(title, code=code, woo_product_id=woo_id)
        descriptions.append(build_description(facts))
    return descriptions
