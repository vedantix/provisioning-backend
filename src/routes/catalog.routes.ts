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
    const products = await catalogService.listProducts();

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
    const result = await catalogService.syncProduct(String(req.params.code));

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  }),
);

export default router;
