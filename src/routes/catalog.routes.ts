import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler';
import { requireAdminAuthMiddleware } from '../middleware/require-admin-auth.middleware';
import { requireActorContextMiddleware } from '../middleware/require-actor-context.middleware';
import { ProductCatalogService } from '../services/catalog/product-catalog.service';

const router = Router();
const catalogService = new ProductCatalogService();

router.use(requireAdminAuthMiddleware);
router.use(requireActorContextMiddleware);

router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const products = await catalogService.listProducts(req.ctx.tenantId);

    res.status(200).json({
      data: products,
      requestId: req.ctx.requestId,
    });
  }),
);

router.post(
  '/products',
  asyncHandler(async (req, res) => {
    const product = await catalogService.upsertProduct({
      code: req.body?.code,
      name: req.body?.name,
      description: req.body?.description,
      monthlyPrice: req.body?.monthlyPrice,
      setupPrice: req.body?.setupPrice,
    });

    res.status(200).json({
      data: product,
      requestId: req.ctx.requestId,
    });
  }),
);

router.post(
  '/products/:code/sync',
  asyncHandler(async (req, res) => {
    const productInput = req.body?.product
      ? {
          code: req.body.product.code || req.params.code,
          name: req.body.product.name,
          description: req.body.product.description,
          monthlyPrice: req.body.product.monthlyPrice,
          setupPrice: req.body.product.setupPrice,
        }
      : undefined;

    const result = await catalogService.syncProduct(
      String(req.params.code),
      req.ctx.tenantId,
      productInput,
    );

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  }),
);

export default router;
