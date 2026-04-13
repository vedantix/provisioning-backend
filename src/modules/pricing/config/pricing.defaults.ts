import type { PricingAddonRecord, PricingPackageRecord } from "../types/pricing.types";

const now = new Date().toISOString();
const VAT_RATE = 0.21;

function fromInclusive(amountInclVat: number) {
  const excl = Number((amountInclVat / (1 + VAT_RATE)).toFixed(2));
  const vat = Number((amountInclVat - excl).toFixed(2));
  return { incl: Number(amountInclVat.toFixed(2)), excl, vat };
}

function fromExclusive(amountExclVat: number) {
  const vat = Number((amountExclVat * VAT_RATE).toFixed(2));
  const incl = Number((amountExclVat + vat).toFixed(2));
  return { incl, excl: Number(amountExclVat.toFixed(2)), vat };
}

const starterMonthly = fromInclusive(99);
const starterSetup = fromInclusive(599);
const starterInfra = fromExclusive(8);

const growthMonthly = fromInclusive(149);
const growthSetup = fromInclusive(850);
const growthInfra = fromExclusive(12);

const proMonthly = fromInclusive(249);
const proSetup = fromInclusive(1250);
const proInfra = fromExclusive(18);

const customMonthly = fromInclusive(399);
const customSetup = fromInclusive(2000);
const customInfra = fromExclusive(25);

export const DEFAULT_PACKAGES: PricingPackageRecord[] = [
  {
    id: "pkg_starter",
    code: "STARTER",
    label: "Starter",
    slug: "starter",
    description: "Voor starters en kleine lokale bedrijven",
    monthlyPriceInclVat: starterMonthly.incl,
    monthlyPriceExclVat: starterMonthly.excl,
    monthlyVatAmount: starterMonthly.vat,
    setupPriceInclVat: starterSetup.incl,
    setupPriceExclVat: starterSetup.excl,
    setupVatAmount: starterSetup.vat,
    monthlyInfraCostExclVat: starterInfra.excl,
    monthlyInfraCostVatAmount: starterInfra.vat,
    monthlyInfraCostInclVat: starterInfra.incl,
    vatRate: VAT_RATE,
    featured: false,
    isActive: true,
    sortOrder: 1,
    fit: "Voor starters, zzp’ers en kleine lokale bedrijven",
    cancelNote: "Betaling pas na oplevering · opzegbaar vanaf 6 maanden",
    cta: "Bespreek Starter →",
    bullets: [
      "Professionele website tot 5 pagina’s",
      "Mobielvriendelijk ontwerp",
      "WhatsApp, bellen en contactformulier",
      "Onderhoud en kleine updates inbegrepen",
    ],
    included: [
      "Professionele website",
      "Tot 5 pagina’s",
      "1 zakelijk mailadres",
      "Mobielvriendelijk ontwerp",
      "Contactformulier en WhatsApp-knop",
      "Onderhoud en kleine updates",
      "Je website blijft online en veilig",
    ],
    notIncluded: [
      "Geen klantomgeving of login",
      "Geen uitgebreide reserveringsmodule",
      "Geen maatwerk functionaliteit",
      "Niet bedoeld voor complexe processen",
    ],
    addons: [
      "Extra mailadressen",
      "Extra pagina’s",
      "Lokale SEO uitbreiding",
      "Blog of FAQ uitbreiding",
      "Extra formulieren of secties",
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "pkg_growth",
    code: "GROWTH",
    label: "Growth",
    slug: "growth",
    description: "Voor bedrijven die meer aanvragen willen",
    monthlyPriceInclVat: growthMonthly.incl,
    monthlyPriceExclVat: growthMonthly.excl,
    monthlyVatAmount: growthMonthly.vat,
    setupPriceInclVat: growthSetup.incl,
    setupPriceExclVat: growthSetup.excl,
    setupVatAmount: growthSetup.vat,
    monthlyInfraCostExclVat: growthInfra.excl,
    monthlyInfraCostVatAmount: growthInfra.vat,
    monthlyInfraCostInclVat: growthInfra.incl,
    vatRate: VAT_RATE,
    featured: true,
    isActive: true,
    sortOrder: 2,
    fit: "Meest gekozen door kappers, salons, fotografen en klusbedrijven",
    cancelNote: "Betaling pas na oplevering · opzegbaar vanaf 6 maanden",
    cta: "Bespreek Growth →",
    bullets: [
      "Alles uit Starter",
      "Meer pagina’s en sterkere SEO-structuur",
      "Blog, FAQ of extra landingspagina’s mogelijk",
      "Meer ruimte om diensten duidelijker te verkopen",
    ],
    included: [
      "Alles uit Starter",
      "Meer pagina’s en meer inhoud",
      "5 zakelijke mailadressen",
      "Blog of FAQ mogelijk",
      "Sterkere SEO-opbouw",
      "Meer ruimte voor dienstenpagina’s en landingspagina’s",
    ],
    notIncluded: [
      "Geen uitgebreide klantomgeving standaard",
      "Geen zwaar maatwerk standaard",
      "Niet bedoeld voor complexe interne workflows",
    ],
    addons: [
      "Extra pagina’s",
      "Extra mailadressen",
      "Reserveringsmodule",
      "Uitgebreidere leadformulieren",
      "Extra SEO-landingspagina’s",
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "pkg_pro",
    code: "PRO",
    label: "Pro",
    slug: "pro",
    description: "Voor bedrijven die online processen willen automatiseren",
    monthlyPriceInclVat: proMonthly.incl,
    monthlyPriceExclVat: proMonthly.excl,
    monthlyVatAmount: proMonthly.vat,
    setupPriceInclVat: proSetup.incl,
    setupPriceExclVat: proSetup.excl,
    setupVatAmount: proSetup.vat,
    monthlyInfraCostExclVat: proInfra.excl,
    monthlyInfraCostVatAmount: proInfra.vat,
    monthlyInfraCostInclVat: proInfra.incl,
    vatRate: VAT_RATE,
    featured: false,
    isActive: true,
    sortOrder: 3,
    fit: "Voor reserveringen, intake, dashboards en workflows",
    cancelNote: "Betaling pas na oplevering · opzegbaar vanaf maand 3",
    cta: "Bespreek Pro →",
    bullets: [
      "Alles uit Growth",
      "Dashboard of klantomgeving mogelijk",
      "Reserveringen, intake of formulieren met logica",
      "Meer maatwerk en doorontwikkeling",
    ],
    included: [
      "Alles uit Growth",
      "10 zakelijke mailadressen",
      "Klantomgeving of dashboard mogelijk",
      "Reserveringen, intake of workflows mogelijk",
      "Meer maatwerk en doorontwikkeling",
      "Geschikt voor bedrijven die online processen willen ondersteunen",
    ],
    notIncluded: [
      "Zeer specialistisch maatwerk alleen op offertebasis",
    ],
    addons: [
      "Extra mailadressen",
      "Extra opslag of uitgebreide formulieren",
      "Extra beveiliging",
      "Extra maatwerk modules",
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "pkg_custom",
    code: "CUSTOM",
    label: "Custom",
    slug: "custom",
    description: "Voor trajecten die buiten de standaard pakketten vallen",
    monthlyPriceInclVat: customMonthly.incl,
    monthlyPriceExclVat: customMonthly.excl,
    monthlyVatAmount: customMonthly.vat,
    setupPriceInclVat: customSetup.incl,
    setupPriceExclVat: customSetup.excl,
    setupVatAmount: customSetup.vat,
    monthlyInfraCostExclVat: customInfra.excl,
    monthlyInfraCostVatAmount: customInfra.vat,
    monthlyInfraCostInclVat: customInfra.incl,
    vatRate: VAT_RATE,
    featured: false,
    isActive: true,
    sortOrder: 4,
    fit: "Voor specifieke wensen, complexe koppelingen en maatwerktrajecten",
    cancelNote: "Prijs en looptijd op offertebasis",
    cta: "Bespreek Custom →",
    bullets: [
      "Volledig maatwerk traject",
      "Geschikt voor complexe flows of integraties",
      "Meer vrijheid in functionaliteit en structuur",
      "Op basis van scope en offerte",
    ],
    included: [
      "Maatwerk op basis van jouw proces",
      "Flexibele scope",
      "Complexere koppelingen mogelijk",
      "Afstemming op jouw bedrijfssituatie",
    ],
    notIncluded: [
      "Geen vaste standaardscope",
      "Geen vaste standaarddoorlooptijd",
    ],
    addons: [
      "Extra modules",
      "Externe integraties",
      "Custom dashboards",
      "Geavanceerde workflows",
    ],
    createdAt: now,
    updatedAt: now,
  },
];

function addon(code: string, label: string, monthlyIncl: number, setupIncl: number, infraExcl: number, sortOrder: number): PricingAddonRecord {
  const monthly = fromInclusive(monthlyIncl);
  const setup = fromInclusive(setupIncl);
  const infra = fromExclusive(infraExcl);

  return {
    id: `addon_${code.toLowerCase()}`,
    code,
    label,
    description: label,
    monthlyPriceInclVat: monthly.incl,
    monthlyPriceExclVat: monthly.excl,
    monthlyVatAmount: monthly.vat,
    setupPriceInclVat: setup.incl,
    setupPriceExclVat: setup.excl,
    setupVatAmount: setup.vat,
    monthlyInfraCostExclVat: infra.excl,
    monthlyInfraCostVatAmount: infra.vat,
    monthlyInfraCostInclVat: infra.incl,
    vatRate: VAT_RATE,
    isActive: true,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  };
}

export const DEFAULT_ADDONS: PricingAddonRecord[] = [
  addon("BLOG", "Blog / FAQ", 15, 100, 0, 1),
  addon("BOOKING", "Reserveringen", 25, 250, 2, 2),
  addon("ANALYTICS", "Analytics+", 10, 50, 0, 3),
  addon("CRM", "CRM module", 25, 300, 3, 4),
  addon("FORMS", "Form opslag", 12, 75, 1, 5),
  addon("SEO_PLUS", "Local SEO+", 20, 150, 0, 6),
  addon("EXTRA_MAILBOX", "Extra mailbox", 7, 0, 1, 7),
  addon("PRIORITY_SUPPORT", "Priority support", 35, 0, 0, 8),
];