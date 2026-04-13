export const DEFAULT_PACKAGES = [
    {
      code: "STARTER",
      label: "Starter",
      monthlyPrice: 99,
      setupPrice: 500,
      monthlyInfraCost: 8,
      isActive: true,
      sortOrder: 1,
    },
    {
      code: "GROWTH",
      label: "Growth",
      monthlyPrice: 149,
      setupPrice: 850,
      monthlyInfraCost: 12,
      isActive: true,
      sortOrder: 2,
    },
    {
      code: "PRO",
      label: "Pro",
      monthlyPrice: 249,
      setupPrice: 1250,
      monthlyInfraCost: 18,
      isActive: true,
      sortOrder: 3,
    },
    {
      code: "CUSTOM",
      label: "Custom",
      monthlyPrice: 399,
      setupPrice: 2000,
      monthlyInfraCost: 25,
      isActive: true,
      sortOrder: 4,
    },
  ];
  
  export const DEFAULT_ADDONS = [
    {
      code: "BLOG",
      label: "Blog / FAQ",
      monthlyPrice: 15,
      setupPrice: 100,
      monthlyInfraCost: 0,
      isActive: true,
      sortOrder: 1,
    },
    {
      code: "BOOKING",
      label: "Reserveringen",
      monthlyPrice: 25,
      setupPrice: 250,
      monthlyInfraCost: 2,
      isActive: true,
      sortOrder: 2,
    },
    {
      code: "ANALYTICS",
      label: "Analytics+",
      monthlyPrice: 10,
      setupPrice: 50,
      monthlyInfraCost: 0,
      isActive: true,
      sortOrder: 3,
    },
    {
      code: "CRM",
      label: "CRM module",
      monthlyPrice: 25,
      setupPrice: 300,
      monthlyInfraCost: 3,
      isActive: true,
      sortOrder: 4,
    },
    {
      code: "FORMS",
      label: "Form opslag",
      monthlyPrice: 12,
      setupPrice: 75,
      monthlyInfraCost: 1,
      isActive: true,
      sortOrder: 5,
    },
    {
      code: "SEO_PLUS",
      label: "Local SEO+",
      monthlyPrice: 20,
      setupPrice: 150,
      monthlyInfraCost: 0,
      isActive: true,
      sortOrder: 6,
    },
    {
      code: "EXTRA_MAILBOX",
      label: "Extra mailbox",
      monthlyPrice: 7,
      setupPrice: 0,
      monthlyInfraCost: 1,
      isActive: true,
      sortOrder: 7,
    },
    {
      code: "PRIORITY_SUPPORT",
      label: "Priority support",
      monthlyPrice: 35,
      setupPrice: 0,
      monthlyInfraCost: 0,
      isActive: true,
      sortOrder: 8,
    },
  ];
  
  export async function fetchPublicPricing(baseUrl = "", tenantId = "default") {
    try {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, "")}/public/pricing?tenantId=${encodeURIComponent(tenantId)}`
      );
  
      if (!response.ok) {
        throw new Error(`Pricing request failed: ${response.status}`);
      }
  
      const json = await response.json();
      const data = json?.data || {};
  
      return {
        packages: Array.isArray(data.packages) ? data.packages : DEFAULT_PACKAGES,
        addons: Array.isArray(data.addons) ? data.addons : DEFAULT_ADDONS,
      };
    } catch {
      return {
        packages: DEFAULT_PACKAGES,
        addons: DEFAULT_ADDONS,
      };
    }
  }