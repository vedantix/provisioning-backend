export type ProductCatalogRecord = {
  code: string;
  name: string;
  description: string;
  monthlyPrice: number;
  setupPrice: number;
  stripeProductId?: string;
  stripeMonthlyPriceId?: string;
  stripeSetupPriceId?: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
};

export type ProductCatalogInput = {
  code: string;
  name: string;
  description?: string;
  monthlyPrice: number;
  setupPrice: number;
};

export type ProductCatalogSyncResult = {
  product: ProductCatalogRecord;
  stripe: {
    productId: string;
    monthlyPriceId: string;
    setupPriceId: string;
  };
  appRunner: {
    serviceArn: string;
    updateOperationId?: string;
    deploymentOperationId?: string;
    redeployStarted: boolean;
    warning?: string;
  };
  environmentVariables: Record<string, string>;
  warnings?: string[];
};
