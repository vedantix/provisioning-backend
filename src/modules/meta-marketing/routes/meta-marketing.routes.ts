import { Router } from 'express';
import { asyncHandler } from '../../../middleware/async-handler';
import { requireAdminAuthMiddleware } from '../../../middleware/require-admin-auth.middleware';
import { requireActorContextMiddleware } from '../../../middleware/require-actor-context.middleware';
import { MetaMarketingController } from '../controllers/meta-marketing.controller';

const router = Router();
const controller = new MetaMarketingController();

router.get('/webhook', controller.webhookVerify);
router.post('/webhook', asyncHandler(controller.webhookReceive));

router.use(requireAdminAuthMiddleware);
router.use(requireActorContextMiddleware);

router.get('/oauth/url', asyncHandler(controller.oauthUrl));
router.post('/oauth/callback', asyncHandler(controller.oauthCallback));
router.get('/connection', asyncHandler(controller.connection));
router.get('/assets', asyncHandler(controller.assets));
router.post('/connection/assets', asyncHandler(controller.selectAssets));

router.get('/campaigns', asyncHandler(controller.listCampaigns));
router.post('/campaigns', asyncHandler(controller.createCampaign));
router.put('/campaigns/:campaignId', asyncHandler(controller.updateCampaign));
router.post('/campaigns/:campaignId/start', asyncHandler(controller.campaignAction('ACTIVE')));
router.post('/campaigns/:campaignId/stop', asyncHandler(controller.campaignAction('PAUSED')));
router.post('/campaigns/:campaignId/archive', asyncHandler(controller.campaignAction('ARCHIVED')));
router.post('/campaigns/:campaignId/duplicate', asyncHandler(controller.duplicateCampaign));

router.get('/adsets', asyncHandler(controller.listAdSets));
router.post('/adsets', asyncHandler(controller.createAdSet));

router.get('/creatives', asyncHandler(controller.listCreatives));
router.post('/creatives', asyncHandler(controller.createCreative));
router.get('/ads', asyncHandler(controller.listAds));
router.post('/ads', asyncHandler(controller.createAd));

router.get('/leads', asyncHandler(controller.listLeads));
router.put('/leads/:leadId', asyncHandler(controller.updateLead));
router.post('/leads/:leadId/activities', asyncHandler(controller.addLeadActivity));

router.get('/dashboard', asyncHandler(controller.dashboard));
router.post('/insights/sync', asyncHandler(controller.syncInsights));

router.get('/recommendations', asyncHandler(controller.recommendationsList));
router.post('/recommendations/generate', asyncHandler(controller.recommendationsGenerate));
router.post('/assistant/ad-variants', asyncHandler(controller.adVariants));

router.get('/pixel/snippet', asyncHandler(controller.pixelSnippet));
router.post('/capi/events', asyncHandler(controller.capiEvent));

export default router;
