// Single source of truth for dashboard translations.
// English is the default language. Emojis are strictly forbidden.

export const translations = {
  en: {
    // Navigation / Tabs
    brand_title: "Zabka Collector",
    tab_siec: "Network",
    tab_spoleczenstwo: "Zabka & Poland",
    skip_link: "Skip to content",
    nav_aria: "Main navigation",
    tablist_aria: "Dashboard sections",
    sr_h1: "Zabka Collector - Interactive Atlas of the Store Network in Poland",
    play_animation: "Play animation",

    // Common / Filter
    filter_prefix: "Filter:",
    filter_clear: "Clear filter",

    // Siec Tab - Hero
    hero_eyebrow_siec: "Zabka Atlas · Snapshot",
    hero_number_label_siec: "active stores in Poland",
    hero_h1_siec: "Zabka is everywhere. We have the hard data.",
    hero_lede_siec: "45.4% of today's network was established since 2023. Here is how thirteen thousand stores spread across Poland, year by year.",

    // Siec Tab - Stat Strip
    stat_kicker_startup: "Startup",
    stat_sub_startup: "took to open the first <b>1,000</b> stores",
    stat_unit_years: "years",
    stat_kicker_accel: "Acceleration",
    stat_sub_accel: "took for the last <b>5,000</b> – the pace skyrocketed",
    stat_kicker_hoursstd: "Standard hours",
    stat_sub_hoursstd: "of stores run the standard 06:00-23:00 Mon-Sat hours",
    stat_kicker_neighbor: "Nearest Neighbor",
    stat_sub_neighbor: "median distance to the nearest Zabka",
    stat_unit_meters: "m",
    stat_kicker_cities: "Cities with Zabka",
    stat_sub_cities: "of Polish cities have a Zabka",
    stat_kicker_new_month: "New this month",
    stat_sub_new_month: "stores opened in the last month",

    // Expansion Map & Calendar
    map_growth_title: "How the network grew: 1998–2026",
    map_growth_sub: "Each dot is a store, appearing in its opening year. Alongside is the opening calendar month-by-month – the slider drives both.",
    calendar_aria_label: "Calendar of store openings month-by-month, 1998–2026. Darker fields indicate more openings in a given month.",
    slider_year_label: "Year of network expansion",

    // Growth Chart
    chart_growth_title: "When stores that are still active opened",
    chart_growth_sub: "Bars: new stores in a year (left axis). Line: year-over-year change % (hover for value).",
    chart_growth_legend_new: "New stores",
    chart_growth_legend_yoy: "YoY change",
    chart_growth_survival_note: "Survival bias: active stores only — closed stores are excluded from the dataset. Early years (1998–2010) are underrepresented. 218 stores without opening dates are omitted.",

    // Origins Card
    origin_old_kicker: "Oldest (still active)",
    origin_old_note: "opened",
    origin_old_note_suffix: " – and still on the map",
    origin_new_kicker: "Newest Zabka",
    origin_new_note: "opened",
    origin_new_note_suffix: " – the newest point on the map",

    // Fingerprint Card
    fingerprint_title: "Unrolled Fingerprint – growth rings, N–E–S–W–N direction",
    fingerprint_sub: "The same data unrolled from the polar layout: X-axis is direction (N–E–S–W–N), Y-axis is year. Each ring represents one year, and the bulge indicates the dominant direction of expansion. Hover for details.",
    fingerprint_aria: "Unrolled fingerprint: each horizontal ring is a year 1998–2026, bulge to left/right shows dominant direction. Hover for details.",
    fingerprint_hint_mouse: "Hover over a ring – each horizontal band is one year of expansion.",
    fingerprint_hint_touch: "Touch and drag over a ring – each horizontal band is one year of expansion.",

    // Bridge Cards
    bridge_expansion: "Expansion direction year-by-year is one story. The other is: how many stores and where. Mazowieckie leads in absolute numbers — but Pomorskie wins per capita.",
    bridge_econ_text: "The network looks evenly spread. The data tells a different story.",
    bridge_econ: "Wealthier districts have more stores. The West closes on Sundays, while the rest does not. None of these patterns are accidental.",

    // Najwiecej Zabek (Granular)
    gran_title: "Most Zabkas – districts",
    gran_sub: "active stores count",
    gran_dim_woj: "Voivodeship",
    gran_dim_powiat: "Districts",
    gran_dim_city: "Cities",
    gran_metric_count: "Count",
    gran_metric_per1k: "Zabkas/1k residents",
    gran_metric_per_km2: "Zabkas/km²",
    gran_sort_desc: "Largest",
    gran_sort_asc: "Smallest",
    gran_chart_aria: "Ranking of administrative units by number of Zabka stores. Toggles allow choosing level and metric.",
    gran_ref_others: "Others (avg.)",

    // KPI Strip (Atlas krancow)
    edge_kpi_h24: "24/7 Stores",
    edge_kpi_h24_sub: "never closed",
    edge_kpi_h24_tile: "24/7 Stores - show on map",
    edge_kpi_parks: "In Parks",
    edge_kpi_parks_sub: "stores in national parks and reserves",
    edge_kpi_parks_tile: "Stores in national parks - show on map",
    edge_kpi_frogs: "Amphibian Record",
    edge_kpi_frogs_sub: "amphibian sightings near a single Zabka",
    edge_kpi_frogrecord_tile: "Amphibian record - show on map",
    edge_kpi_void: "Bieszczady Void",
    edge_kpi_void_sub: "from the nearest Zabka",
    edge_kpi_void_tile: "Bieszczady void - show on map",
    edge_kpi_oldest: "Oldest Active",
    edge_kpi_oldest_sub: "Swarzędz · active for 28 years",
    edge_kpi_oldest_tile: "Oldest active store - show on map",
    edge_kpi_farthest: "Farthest from Frog",
    edge_kpi_farthest_sub: "to the nearest amphibian sighting",
    edge_kpi_farthestfrog_tile: "Farthest from frog - show on map",
    oldest_active_sub: "{city} · active for {age} years",
    ep_zerofrog_note: "stores ({pct}%) with zero amphibian sightings in 5 km",
    frog_street_note: "Zabka on Green Frog Street – one of {cnt} stores on streets with frog themes.",
    cities_funnel_text: "out of {total} Polish cities have a Zabka",
    tooltip_year: "Year: {year}",
    tooltip_new_stores: "New stores: {count}",
    tooltip_yoy: "YoY change: {pct}",
    load_more_format: "Load more ({current}/{total})",
    gran_word_voivodeship: "voivodeships",
    gran_word_powiat: "districts",
    gran_word_city: "cities",
    gran_metric_per1k_label: "stores per 1,000 residents",
    gran_metric_per_km2_label: "stores per km²",
    gran_title_format_asc: "Fewest Zabkas – {word}",
    gran_title_format_desc: "Most Zabkas – {word}",
    legend_avg: "avg. {val}",
    legend_median: "median {val}",
    suffix_per1k: "stores/1k",
    suffix_per_km2: "stores/km²",
    lead_totals_template: "<b>{total}</b> stores in <b>{powiats}</b> districts. In two chapters, we check if network density follows <b>wealth</b> and <b>employment</b> – and what the numbers really say.",
    resort_sub_per1k: "communes by stores per 1,000 registered residents – sea and mountains beat the rest of the country",
    resort_sub_perkm2: "communes by stores per km² – large cities win here",
    nbl_sub_template: "{metric} distance to the nearest Zabka, by {level}",
    dumbbell_title_template: "Zabka vs InPost – top {length} {label} alphabetically ({total} total)",

    // Atlas krancow map
    atlas_title: "Atlas of Extremes",
    atlas_reset: "Reset to full map",
    map_zoom_hint_mouse: "ctrl + scroll zooms",
    map_zoom_hint_touch: "use two fingers to pan and zoom",

    // Extremes Panels
    ep_frog_panel: "Zabka on Green Frog Street – show on map",
    ep_frog_eyebrow: "Collector's Gem",
    ep_frog_city: "Zabia Wola, Mazowieckie",
    ep_frog_note: "Zabka on Green Frog Street – a perfect marketing coincidence.",
    ep_highest_panel: "Highest altitude store – show on map",
    ep_highest_eyebrow: "Highest Altitude",
    ep_highest_city: "Koscielisko, Malopolskie",
    ep_highest_street: "Nedzy Kubinca 101",
    ep_lowest_panel: "Store below sea level – show on map",
    ep_lowest_eyebrow: "Only one below sea level",
    ep_lowest_city: "Gdansk (port), Pomorskie",
    ep_lowest_street: "Przelom 12",
    ep_isolated_panel: "Most isolated store – show on map",
    ep_isolated_eyebrow: "Farthest from neighbor",
    ep_isolated_city: "Michalowo, Podlaskie",
    ep_isolated_street: "Bialostocka 2",
    ep_zerofrog_panel: "Store without any frogs nearby – show on map",
    ep_zerofrog_eyebrow: "Zabka without any frogs nearby",
    ep_zerofrog_sub: "stores with zero amphibian sightings in 5 km",

    // Coverage Donut
    coverage_title: "Zabka is almost everywhere",
    coverage_sub: "percentage of units with a Zabka – green: covered, red: empty",
    coverage_donut_aria: "Pie chart: percentage of administrative units with at least one Zabka.",
    coverage_map_aria: "Map of Poland: green units have a Zabka, red do not.",
    coverage_suffix_powiat: "districts have a Zabka",
    coverage_suffix_city: "cities have a Zabka",
    coverage_suffix_gmina: "communes have a Zabka",

    // Bubble Chart
    bubble_title: "What makes up the network – cities",
    bubble_sub: "Bubble size represents the number of stores. Drag to pan; Ctrl + scroll to zoom. Small units fall into 'Others'.",

    // Spoleczenstwo Tab - Hero
    hero_eyebrow_spol: "Zabka & Poland · Culture and Nation",
    hero_h1_spol: "Maximum distance to a Zabka in Poland.",
    hero_lede_spol: "In Poland, Zabka feels right at home. In nearly 30 years, it has become a cultural icon of the country. Let's see where else it fits into Polish culture. Or does it rewrite it?",

    // Spoleczenstwo Tab - KPI Strip
    spol_kpi_residents_kicker: "One store per",
    spol_kpi_residents_unit: " people",
    spol_kpi_residents_sub: "residents of Poland",
    spol_kpi_gminy_kicker: "Commune coverage",
    spol_kpi_gminy_sub: "of communes have at least one Zabka",
    spol_kpi_density_kicker: "Density outlier",
    spol_kpi_density_sub_tpl: "{name}: the densest network in the country",
    spol_kpi_gminaleader_kicker: "Per-capita record",
    spol_kpi_gminaleader_sub_tpl: "{name}: most stores per resident in Poland",
    spol_kpi_inpostmax_kicker: "InPost extreme",
    spol_kpi_inpostmax_sub_tpl: "{name}: the most parcel lockers per store",
    spol_kpi_sunday_kicker: "Sunday Wall",
    spol_kpi_sunday_sub_tpl: "{name}: closed on Sundays vs the national average",

    // Zabka vs InPost
    inpost_title: "Zabka vs InPost",
    inpost_sub: "A duel between two giants of Polish public space. Both serve different needs — Zabka is shopping, InPost is parcel pickup — but both compete for the same square meter of the street.",
    legend_zabka_100k: "Zabka/100k",
    legend_inpost_100k: "InPost/100k",

    // KNN (Density)
    knn_title: "How dense are Zabkas – typical distance to neighbor",
    knn_sub: "median distance to the nearest Zabka, by voivodeship",
    knn_median: "Median",
    knn_mean: "Average",
    knn_rarest: "Rarest",
    knn_densest: "Densest",
    knn_caveat: "The median is robust against single isolated stores; the average is skewed upward by extremes (in Podkarpackie the average is ~1.8 km, while the median is 459 m).",
    knn_half_title: "Half of the network has a neighbor closer than 300 m",
    knn_half_sub: "Distribution of distance to the nearest store (k-NN).",
    knn_stat_max: "max.",

    // Streets
    streets_title: "Streets with the most Zabkas",
    streets_sub_prefix: "Specific street and city, not just the name – total of ",
    streets_sub_suffix: " stores",

    // Resort Communes
    resort_title: "Most Zabkas per capita? Resorts.",
    resort_sub: "communes by stores per 1,000 registered residents – sea and mountains beat the rest of the country",
    resort_caveat: "Registered population counts residents, but resort towns host many times more people in summer. That is precisely the point: the network follows tourists, not registration records.",

    // Econ maps
    econ_intro_title: "Where there are more Zabkas than economics predict",
    econ_intro_sub: "Two maps of districts. The color shows the deviation from the trend line: how many more (green) or fewer (red) stores per 1,000 residents exist than predicted by a simple correlation with the selected indicator. White districts sit exactly on the trend line. Green indicates a higher density than economics would explain.",
    econ_unemp_title: "Residuals vs Unemployment",
    econ_unemp_sub: "Usually, higher unemployment means a sparser network. Green shows districts that still have more Zabkas than unemployment suggests.",
    econ_salary_title: "Residuals vs Wages",
    econ_salary_sub: "Wealthier districts have a denser network. Green = denser, red = sparser than wages alone would suggest.",
    econ_error_load: "Failed to load data.",
    econ_error_retry: "Try again",

    // Footer
    foot_built_with: "Built with public data",
    foot_methodology: "Methodology",
    foot_portfolio: "Portfolio",
    foot_last_updated: "Data updated",
    stat_unit_meters_km: " km"
  },
  pl: {
    // Navigation / Tabs
    brand_title: "Żabkozbiór",
    tab_siec: "Sieć",
    tab_spoleczenstwo: "Żabka a Polska",
    skip_link: "Przejdź do treści",
    nav_aria: "Nawigacja główna",
    tablist_aria: "Sekcje dashboardu",
    sr_h1: "Żabkozbiór – interaktywny atlas sieci sklepów w Polsce",
    play_animation: "Odtwórz animację",

    // Common / Filter
    filter_prefix: "Filtruj:",
    filter_clear: "×",

    // Siec Tab - Hero
    hero_eyebrow_siec: "Atlas Żabki · migawka",
    hero_number_label_siec: "aktywnych sklepów w Polsce",
    hero_h1_siec: "Żabka jest wszędzie. Mamy na to twarde dane.",
    hero_lede_siec: "45,4% dzisiejszej sieci powstało od 2023 roku. Oto jak trzynaście tysięcy sklepów rozlało się po Polsce, rok po roku.",

    // Siec Tab - Stat Strip
    stat_kicker_startup: "Rozruch",
    stat_sub_startup: "zajął pierwszy <b>1 000</b> sklepów",
    stat_unit_years: "lat",
    stat_kicker_accel: "Przyspieszenie",
    stat_sub_accel: "zajęły ostatnie <b>5 000</b> – tempo wystrzeliło",
    stat_kicker_hoursstd: "Standardowe godziny",
    stat_sub_hoursstd: "sklepów działa w standardowych godzinach 06:00–23:00 pon-sob",
    stat_kicker_neighbor: "Najbliższy sąsiad",
    stat_sub_neighbor: "mediana odległości do najbliższej Żabki",
    stat_unit_meters: " m",
    stat_kicker_cities: "Miast z Żabką",
    stat_sub_cities: "polskich miast ma Żabkę",
    stat_kicker_new_month: "Nowe w tym miesiącu",
    stat_sub_new_month: "sklepów otwartych w ostatnim miesiącu",

    // Expansion Map & Calendar
    map_growth_title: "Tak rosła sieć: 1998–2026",
    map_growth_sub: "Każda kropka to sklep, pojawia się w roku otwarcia. Obok kalendarz otwarć miesiąc po miesiącu – suwak prowadzi oba.",
    calendar_aria_label: "Kalendarz otwarć sklepów miesiąc po miesiącu, 1998–2026. Ciemniejsze pola oznaczają więcej otwarć w danym miesiącu.",
    slider_year_label: "Rok ekspansji sieci",

    // Growth Chart
    chart_growth_title: "Kiedy otwarto sklepy, które wciąż działają",
    chart_growth_sub: "Słupki: nowe sklepy w roku (oś po lewej). Linia: zmiana rok do roku % (bez własnej osi – najedź kursorem po wartość).",
    chart_growth_legend_new: "Nowe sklepy",
    chart_growth_legend_yoy: "Zmiana r/r",
    chart_growth_survival_note: "Bias przeżywalności: tylko aktywne sklepy — zamknięte wypadły z datasetu. Wczesne lata (1998–2010) niedoszacowane. 218 sklepów bez daty pominięto.",

    // Origins Card
    origin_old_kicker: "Najstarsza (wciąż działa)",
    origin_old_note: "otwarta",
    origin_old_note_suffix: " – i nadal na mapie",
    origin_new_kicker: "Najnowsza Żabka",
    origin_new_note: "otwarta",
    origin_new_note_suffix: " – najświeższy punkt na mapie",

    // Fingerprint Card
    fingerprint_title: "Odcisk wyprostowany – słoje lat, kierunek N–E–S–W–N",
    fingerprint_sub: "Te same dane, rozwinięte z układu biegunowego: oś X to kierunek (N–E–S–W–N), oś Y to rok. Każdy słój to jeden rok, a wybrzuszenie to dominujący kierunek ekspansji. Najedź na słój po szczegóły.",
    fingerprint_aria: "Odcisk wyprostowany: każdy poziomy słój to rok 1998–2026, wybrzuszenie w lewo lub prawo pokazuje dominujący kierunek ekspansji sieci w danym roku (N–E–S–W–N). Najedź na słój żeby zobaczyć szczegóły.",
    fingerprint_hint_mouse: "Najedź na słój – każdy poziomy pas to jeden rok ekspansji.",
    fingerprint_hint_touch: "Dotknij i przesuń po słoju – każdy poziomy pas to jeden rok ekspansji.",

    // Bridge Cards
    bridge_expansion: "Kierunek ekspansji rok po roku to jedna historia. Druga: ile sklepów i gdzie. Mazowieckie prowadzi w liczbach bezwzględnych — ale per capita wygrywa Pomorskie.",
    bridge_econ_text: "Sieć wygląda równomiernie. Dane mówią inaczej.",
    bridge_econ: "Bogatsze powiaty mają więcej sklepów. Zachód zamyka w niedziele, choć reszta nie. Żaden z tych wzorców nie jest przypadkowy.",

    // Najwiecej Zabek (Granular)
    gran_title: "Najwięcej Żabek – powiaty",
    gran_sub: "liczba aktywnych sklepów",
    gran_dim_woj: "Woj.",
    gran_dim_powiat: "Powiaty",
    gran_dim_city: "Miasta",
    gran_metric_count: "Liczba",
    gran_metric_per1k: "zab./1000mieszk.",
    gran_metric_per_km2: "zab./km²",
    gran_sort_desc: "Największe",
    gran_sort_asc: "Najmniejsze",
    gran_chart_aria: "Ranking jednostek administracyjnych według liczby sklepów Żabka. Przełączniki nad wykresem pozwalają wybrać poziom i metrykę.",
    gran_ref_others: "Pozostałe (śr.)",

    // KPI Strip (Atlas krancow)
    edge_kpi_h24: "Sklepy 24/7",
    edge_kpi_h24_sub: "nigdy nie zamknięte",
    edge_kpi_h24_tile: "Sklepy 24/7 – pokaż na mapie",
    edge_kpi_parks: "W parkach",
    edge_kpi_parks_sub: "sklepów w parkach i rezerwatach",
    edge_kpi_parks_tile: "Sklepy w parkach – pokaż na mapie",
    edge_kpi_frogs: "Rekord płaza",
    edge_kpi_frogs_sub: "obserwacji płazów przy jednej Żabce",
    edge_kpi_frogrecord_tile: "Rekord płaza – pokaż na mapie",
    edge_kpi_void: "Pustka Bieszczad",
    edge_kpi_void_sub: "od najbliższej Żabki",
    edge_kpi_void_tile: "Pustka Bieszczad – pokaż na mapie",
    edge_kpi_oldest: "Najstarsza aktywna",
    edge_kpi_oldest_sub: "Swarzędz · działa od 28 lat",
    edge_kpi_oldest_tile: "Najstarsza aktywna Żabka – pokaż na mapie",
    edge_kpi_farthest: "Najdalej od zaby",
    edge_kpi_farthest_sub: "do najbliższej obserwacji płaza",
    edge_kpi_farthestfrog_tile: "Najdalej od żaby – pokaż na mapie",

    // Atlas krancow map
    atlas_title: "Atlas krańców",
    atlas_reset: "Powrót do pełnej mapy",
    map_zoom_hint_mouse: "ctrl + scroll przybliża",
    map_zoom_hint_touch: "dwoma palcami przesuwasz i przybliżasz",

    // Extremes Panels
    ep_frog_panel: "Żabka na ulicy Zielonej Żabki – pokaż na mapie",
    ep_frog_eyebrow: "Perła kolekcji",
    ep_frog_city: "Żabia Wola, mazowieckie",
    ep_frog_note: "Żabka przy ulicy Zielonej Żabki – idealny marketingowy zbieg okoliczności.",
    ep_highest_panel: "Najwyżej położony sklep – pokaż na mapie",
    ep_highest_eyebrow: "Najwyżej n.p.m.",
    ep_highest_city: "Kościelisko, małopolskie",
    ep_highest_street: "Nędzy Kubińca 101",
    ep_lowest_panel: "Sklep poniżej poziomu morza – pokaż na mapie",
    ep_lowest_eyebrow: "Jedyna poniżej morza",
    ep_lowest_city: "Gdańsk (port), pomorskie",
    ep_lowest_street: "Przełom 12",
    ep_isolated_panel: "Najbardziej odizolowany sklep – pokaż na mapie",
    ep_isolated_eyebrow: "Najdalej od sąsiadki",
    ep_isolated_city: "Michałowo, podlaskie",
    ep_isolated_street: "Białostocka 2",
    ep_zerofrog_panel: "Sklep bez żab w pobliżu – pokaż na mapie",
    ep_zerofrog_eyebrow: "Żabka bez żadnej żaby w pobliżu",
    ep_zerofrog_sub: "sklepów bez ani jednej obserwacji płaza w 5 km",
    oldest_active_sub: "{city} · działa od {age} lat",
    ep_zerofrog_note: "sklepów ({pct}%) bez ani jednej obserwacji płaza w 5 km",
    frog_street_note: "Żabka przy ulicy Zielonej Żabki – jeden z {cnt} sklepów na ulicach z żabim motywem.",
    cities_funnel_text: "z {total} polskich miast ma Żabkę",
    tooltip_year: "Rok: {year}",
    tooltip_new_stores: "Nowe sklepy: {count}",
    tooltip_yoy: "Zmiana r/r: {pct}",
    load_more_format: "Załaduj więcej ({current}/{total})",
    gran_word_voivodeship: "województwa",
    gran_word_powiat: "powiaty",
    gran_word_city: "miasta",
    gran_metric_per1k_label: "sklepy na 1000 mieszkańców",
    gran_metric_per_km2_label: "sklepy na km²",
    gran_title_format_asc: "Najmniej Żabek – {word}",
    gran_title_format_desc: "Najwięcej Żabek – {word}",
    legend_avg: "śr. {val}",
    legend_median: "mediana {val}",
    suffix_per1k: "żab./1k",
    suffix_per_km2: "żab./km²",
    lead_totals_template: "<b>{total}</b> sklepów w <b>{powiats}</b> powiatach. W dwóch rozdziałach sprawdzamy, czy gęstość sieci idzie za <b>pieniędzmi</b> i za <b>pracą</b> – i co tak naprawdę mówią o tym liczby.",
    resort_sub_per1k: "gminy wg sklepów na 1000 zameldowanych – morze i góry biją resztę kraju",
    resort_sub_perkm2: "gminy wg sklepów na km² – tu wygrywają wielkie miasta",
    nbl_sub_template: "{metric} odległości do najbliższej Żabki, według {level}",
    dumbbell_title_template: "Żabka vs InPost – top {length} {label} alfabetycznie ({total} łącznie)",

    // Coverage Donut
    coverage_title: "Żabka jest niemal wszędzie",
    coverage_sub: "odsetek jednostek z Żabką – zielone: pokryte, czerwone: bez",
    coverage_donut_aria: "Wykres kołowy: odsetek jednostek administracyjnych z co najmniej jedną Żabką.",
    coverage_map_aria: "Mapa Polski: zielone jednostki mają Żabkę, czerwone nie mają.",
    coverage_suffix_powiat: "powiatów ma Żabkę",
    coverage_suffix_city: "miast ma Żabkę",
    coverage_suffix_gmina: "gmin ma Żabkę",

    // Bubble Chart
    bubble_title: "Z czego składa się sieć – miasta",
    bubble_sub: "Wielkość bąbla to liczba sklepów. Przeciągnij; Ctrl + scroll przybliża. Małe jednostki trafiają do „Pozostałych\".",

    // Spoleczenstwo Tab - Hero
    hero_eyebrow_spol: "Żabka a Polska · Kultura i naród",
    hero_h1_spol: "Maksymalny dystans do Żabki w Polsce.",
    hero_lede_spol: "W Polsce Żabka czuje się jak płaz w wodzie. W prawie 30 lat stała się jednym z kulturowych symboli Polski. Zobaczmy, gdzie jeszcze wpisuje się w polską kulturę. A może ją nadpisuje?",

    // Spoleczenstwo Tab - KPI Strip
    spol_kpi_residents_kicker: "Jeden sklep na",
    spol_kpi_residents_unit: " os.",
    spol_kpi_residents_sub: "mieszkańców Polski",
    spol_kpi_gminy_kicker: "Pokrycie gmin",
    spol_kpi_gminy_sub: "gmin ma co najmniej jedną Żabkę",
    spol_kpi_density_kicker: "Gęstość skrajna",
    spol_kpi_density_sub_tpl: "{name}: najgęstsza sieć w kraju",
    spol_kpi_gminaleader_kicker: "Rekordzista per capita",
    spol_kpi_gminaleader_sub_tpl: "{name}: najwięcej Żabek na mieszkańca w Polsce",
    spol_kpi_inpostmax_kicker: "Skrajność InPost",
    spol_kpi_inpostmax_sub_tpl: "{name}: najwięcej paczkomatów na jedną Żabkę",
    spol_kpi_sunday_kicker: "Ściana niedzielna",
    spol_kpi_sunday_sub_tpl: "{name}: zamknięte w niedzielę vs średnia krajowa",

    // Zabka vs InPost
    inpost_title: "Żabka vs InPost",
    inpost_sub: "Pojedynek dwóch gigantów polskiej przestrzeni publicznej. Obaj robią co innego — Żabka to zakupy, InPost to odbiory paczek — ale oba rywalizują o ten sam metr kwadratowy ulicy.",
    legend_zabka_100k: "Żabka/100k",
    legend_inpost_100k: "InPost/100k",

    // KNN (Density)
    knn_title: "Jak gęsto stoją Żabki – typowy dystans do sąsiadki",
    knn_sub: "mediana odległości do najbliższej Żabki, według województwa",
    knn_median: "Mediana",
    knn_mean: "Średnia",
    knn_rarest: "Najrzadsze",
    knn_densest: "Najgęstsze",
    knn_caveat: "Mediana jest odporna na pojedyncze samotne sklepy; średnią zawyżają wartości skrajne (w podkarpackiem średnia to ~1,8 km, a mediana 459 m).",
    knn_half_title: "Połowa sieci ma sąsiadkę bliżej niż 300 m",
    knn_half_sub: "Rozkład odległości do najbliższego sklepu (k-NN).",
    knn_stat_max: "maks.",

    // Streets
    streets_title: "Ulice z największą liczbą Żabek",
    streets_sub_prefix: "Konkretna ulica i miasto, nie sama nazwa – łącznie ",
    streets_sub_suffix: " sklepów",

    // Resort Communes
    resort_title: "Najwięcej Żabek na mieszkańca? Kurorty.",
    resort_sub: "gminy wg sklepów na 1000 zameldowanych – morze i góry biją resztę kraju",
    resort_caveat: "Liczba mieszkańców to zameldowani, a latem w kurortach jest ich wielokrotnie więcej. I o to właśnie chodzi: sieć idzie za turystą, nie za meldunkiem.",

    // Econ maps
    econ_intro_title: "Gdzie Żabek jest więcej, niż wynikałoby z ekonomii",
    econ_intro_sub: "Dwie mapy powiatów. Kolor to nie surowe zagęszczenie, tylko odchylenie od trendu: o ile sklepów na 1000 mieszkańców jest więcej (zielony) albo mniej (czerwony), niż przewiduje prosta zależność od danego wskaźnika. Biały powiat leży dokładnie na linii trendu. Zieleń tam, gdzie sieć jest gęstsza, niż tłumaczyłaby to ekonomia.",
    econ_unemp_title: "Reszty wobec bezrobocia",
    econ_unemp_sub: "Zwykle im wyższe bezrobocie, tym rzadsza sieć. Zieleń pokazuje powiaty, które i tak mają więcej Żabek, niż sugeruje bezrobocie.",
    econ_salary_title: "Reszty wobec płacy",
    econ_salary_sub: "Bogatsze powiaty mają gęstszą sieć. Zieleń = gęściej, czerwień = rzadziej, niż wynikałoby z samej płacy.",
    econ_error_load: "Nie udało się załadować danych.",
    econ_error_retry: "Spróbuj ponownie",

    // Footer
    foot_built_with: "Zbudowane z danych publicznych",
    foot_methodology: "Metodyka",
    foot_portfolio: "Portfolio",
    foot_last_updated: "Aktualizacja danych",
    stat_unit_meters_km: " km"
  }
};

let currentLang = 'pl'; // Polish default

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (translations[lang]) {
    currentLang = lang;
  }
}

export function t(key) {
  return translations[currentLang]?.[key] || translations['en']?.[key] || translations['pl']?.[key] || key;
}

export function translateDOM() {
  const lang = getLang();
  document.documentElement.lang = lang;

  // Update active status on lang switcher buttons
  document.querySelectorAll('#lang-toggle .lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
  });

  // Translate elements with data-t (innerHTML content)
  document.querySelectorAll('[data-t]').forEach(el => {
    const key = el.getAttribute('data-t');
    const txt = t(key);
    
    // special handling to preserve brand-dot span
    if (key === 'brand_title') {
      const dot = el.querySelector('.brand-dot');
      el.textContent = '';
      if (dot) el.appendChild(dot);
      el.appendChild(document.createTextNode(txt));
    } else {
      el.innerHTML = txt;
    }
  });

  // Translate elements with data-t-aria (aria-label attribute)
  document.querySelectorAll('[data-t-aria]').forEach(el => {
    const key = el.getAttribute('data-t-aria');
    el.setAttribute('aria-label', t(key));
  });

  // Translate elements with data-t-placeholder (placeholder attribute)
  document.querySelectorAll('[data-t-placeholder]').forEach(el => {
    const key = el.getAttribute('data-t-placeholder');
    el.placeholder = t(key);
  });

  // Translate elements with data-t-title (title attribute)
  document.querySelectorAll('[data-t-title]').forEach(el => {
    const key = el.getAttribute('data-t-title');
    el.title = t(key);
  });
}
