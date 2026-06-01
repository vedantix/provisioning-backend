import type { Request, Response } from 'express';
import { BadRequestError } from '../../../errors/app-error';
import { MetaAuthService } from '../services/meta-auth.service';
import { MetaCampaignService } from '../services/meta-campaign.service';
import { MetaAdSetService } from '../services/meta-adset.service';
import { MetaAdService } from '../services/meta-ad.service';
import { MetaLeadService } from '../services/meta-lead.service';
import { MetaInsightsService } from '../services/meta-insights.service';
import { MetaRecommendationService } from '../services/meta-recommendation.service';
import { MetaConversionsService } from '../services/meta-conversions.service';
import { MetaWebhookService } from '../services/meta-webhook.service';

function ctx(req: Request): { tenantId: string; actorId?: string; requestId?: string } {
  const request = req as Request & {
    ctx?: { tenantId?: string; actorId?: string; requestId?: string };
  };
  return {
    tenantId: request.ctx?.tenantId || 'default',
    actorId: request.ctx?.actorId,
    requestId: request.ctx?.requestId,
  };
}

function body(req: Request): Record<string, any> {
  return (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestError(`${name} is required`);
  }
  return value.trim();
}

export class MetaMarketingController {
  constructor(
    private readonly auth = new MetaAuthService(),
    private readonly campaigns = new MetaCampaignService(),
    private readonly adSets = new MetaAdSetService(),
    private readonly ads = new MetaAdService(),
    private readonly leads = new MetaLeadService(),
    private readonly insights = new MetaInsightsService(),
    private readonly recommendations = new MetaRecommendationService(),
    private readonly conversions = new MetaConversionsService(),
    private readonly webhook = new MetaWebhookService(),
  ) {}

  oauthUrl = async (req: Request, res: Response) => {
    const result = this.auth.getAuthorizationUrl({
      redirectUri: typeof req.query.redirectUri === 'string' ? req.query.redirectUri : undefined,
      state: typeof req.query.state === 'string' ? req.query.state : undefined,
    });
    res.status(200).json({ data: result, requestId: ctx(req).requestId });
  };

  oauthCallback = async (req: Request, res: Response) => {
    const context = ctx(req);
    const payload = body(req);
    const result = await this.auth.connectWithCode({
      tenantId: context.tenantId,
      actorId: context.actorId,
      code: requiredString(payload.code, 'code'),
      redirectUri: typeof payload.redirectUri === 'string' ? payload.redirectUri : undefined,
    });
    const { encryptedAccessToken, ...safe } = result;
    res.status(200).json({ data: safe, requestId: context.requestId });
  };

  connection = async (req: Request, res: Response) => {
    const context = ctx(req);
    const result = await this.auth.getConnectionStatus(context.tenantId);
    res.status(200).json({ data: result, requestId: context.requestId });
  };

  assets = async (req: Request, res: Response) => {
    const context = ctx(req);
    const result = await this.auth.listAssets(context.tenantId);
    res.status(200).json({ data: result, requestId: context.requestId });
  };

  selectAssets = async (req: Request, res: Response) => {
    const context = ctx(req);
    const result = await this.auth.updateConnectionAssets({
      tenantId: context.tenantId,
      actorId: context.actorId,
      ...body(req),
    });
    const { encryptedAccessToken, ...safe } = result;
    res.status(200).json({ data: safe, requestId: context.requestId });
  };

  listCampaigns = async (_req: Request, res: Response) => {
    const data = await this.campaigns.listCampaigns();
    res.status(200).json({ data });
  };

  createCampaign = async (req: Request, res: Response) => {
    const context = ctx(req);
    const payload = body(req);
    const data = await this.campaigns.createCampaign({
      tenantId: context.tenantId,
      actorId: context.actorId,
      name: requiredString(payload.name, 'name'),
      objective: requiredString(payload.objective, 'objective'),
      status: payload.status,
      dailyBudget: Number(payload.dailyBudget || 0) || undefined,
      monthlyBudget: Number(payload.monthlyBudget || 0) || undefined,
      revenue: Number(payload.revenue || 0) || undefined,
      notes: payload.notes,
    });
    res.status(201).json({ data, requestId: context.requestId });
  };

  updateCampaign = async (req: Request, res: Response) => {
    const context = ctx(req);
    const payload = body(req);
    const data = await this.campaigns.updateCampaign({
      tenantId: context.tenantId,
      actorId: context.actorId,
      campaignId: String(req.params.campaignId),
      ...payload,
    });
    res.status(200).json({ data, requestId: context.requestId });
  };

  campaignAction = (status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED') => async (req: Request, res: Response) => {
    const context = ctx(req);
    const data = await this.campaigns.setCampaignStatus({
      tenantId: context.tenantId,
      actorId: context.actorId,
      campaignId: String(req.params.campaignId),
      status,
    });
    res.status(200).json({ data, requestId: context.requestId });
  };

  duplicateCampaign = async (req: Request, res: Response) => {
    const context = ctx(req);
    const data = await this.campaigns.duplicateCampaign({
      tenantId: context.tenantId,
      actorId: context.actorId,
      campaignId: String(req.params.campaignId),
      name: body(req).name,
    });
    res.status(201).json({ data, requestId: context.requestId });
  };

  listAdSets = async (req: Request, res: Response) => {
    const data = await this.adSets.listAdSets(typeof req.query.campaignId === 'string' ? req.query.campaignId : undefined);
    res.status(200).json({ data });
  };

  createAdSet = async (req: Request, res: Response) => {
    const context = ctx(req);
    const payload = body(req);
    const data = await this.adSets.createAdSet({
      tenantId: context.tenantId,
      actorId: context.actorId,
      campaignId: requiredString(payload.campaignId, 'campaignId'),
      name: requiredString(payload.name, 'name'),
      dailyBudget: Number(payload.dailyBudget || 0),
      status: payload.status,
      targeting: payload.targeting || {},
      startTime: payload.startTime,
      endTime: payload.endTime,
      optimizationGoal: payload.optimizationGoal,
      billingEvent: payload.billingEvent,
      bidStrategy: payload.bidStrategy,
    });
    res.status(201).json({ data, requestId: context.requestId });
  };

  listCreatives = async (_req: Request, res: Response) => {
    res.status(200).json({ data: await this.ads.listCreatives() });
  };

  createCreative = async (req: Request, res: Response) => {
    const context = ctx(req);
    const payload = body(req);
    const data = await this.ads.createCreative({
      tenantId: context.tenantId,
      actorId: context.actorId,
      type: payload.type || 'IMAGE',
      name: requiredString(payload.name, 'name'),
      imageUrl: payload.imageUrl,
      videoUrl: payload.videoUrl,
      landingPageUrl: requiredString(payload.landingPageUrl, 'landingPageUrl'),
      headline: requiredString(payload.headline, 'headline'),
      description: payload.description,
      primaryText: requiredString(payload.primaryText, 'primaryText'),
      callToAction: payload.callToAction,
    });
    res.status(201).json({ data, requestId: context.requestId });
  };

  listAds = async (req: Request, res: Response) => {
    const data = await this.ads.listAds(typeof req.query.adSetId === 'string' ? req.query.adSetId : undefined);
    res.status(200).json({ data });
  };

  createAd = async (req: Request, res: Response) => {
    const context = ctx(req);
    const payload = body(req);
    const data = await this.ads.createAd({
      tenantId: context.tenantId,
      actorId: context.actorId,
      adSetId: requiredString(payload.adSetId, 'adSetId'),
      creativeId: requiredString(payload.creativeId, 'creativeId'),
      name: requiredString(payload.name, 'name'),
      status: payload.status,
    });
    res.status(201).json({ data, requestId: context.requestId });
  };

  listLeads = async (req: Request, res: Response) => {
    const data = await this.leads.listLeads(typeof req.query.status === 'string' ? req.query.status as any : undefined);
    res.status(200).json({ data });
  };

  updateLead = async (req: Request, res: Response) => {
    const context = ctx(req);
    const data = await this.leads.updateLead({
      tenantId: context.tenantId,
      actorId: context.actorId,
      leadId: String(req.params.leadId),
      ...body(req),
    });
    res.status(200).json({ data, requestId: context.requestId });
  };

  addLeadActivity = async (req: Request, res: Response) => {
    const context = ctx(req);
    const payload = body(req);
    const data = await this.leads.addActivity({
      tenantId: context.tenantId,
      actorId: context.actorId,
      leadId: String(req.params.leadId),
      type: payload.type || 'NOTE',
      text: requiredString(payload.text, 'text'),
      dueAt: payload.dueAt,
    });
    res.status(201).json({ data, requestId: context.requestId });
  };

  dashboard = async (_req: Request, res: Response) => {
    res.status(200).json({ data: await this.insights.dashboard() });
  };

  syncInsights = async (req: Request, res: Response) => {
    const context = ctx(req);
    const payload = body(req);
    const data = await this.insights.syncInsights({
      tenantId: context.tenantId,
      actorId: context.actorId,
      since: requiredString(payload.since, 'since'),
      until: requiredString(payload.until, 'until'),
      level: payload.level,
    });
    res.status(200).json({ data, requestId: context.requestId });
  };

  adVariants = async (req: Request, res: Response) => {
    const payload = body(req);
    const data = await this.recommendations.generateAdVariants({
      offer: requiredString(payload.offer, 'offer'),
      audience: requiredString(payload.audience, 'audience'),
      goal: requiredString(payload.goal, 'goal'),
      count: Number(payload.count || 5),
    });
    res.status(200).json({ data, requestId: ctx(req).requestId });
  };

  recommendationsList = async (_req: Request, res: Response) => {
    res.status(200).json({ data: await this.recommendations.listRecommendations() });
  };

  recommendationsGenerate = async (req: Request, res: Response) => {
    const context = ctx(req);
    const data = await this.recommendations.generateRecommendations({
      tenantId: context.tenantId,
      actorId: context.actorId,
    });
    res.status(201).json({ data, requestId: context.requestId });
  };

  pixelSnippet = async (req: Request, res: Response) => {
    const pixelId = typeof req.query.pixelId === 'string' ? req.query.pixelId : undefined;
    res.status(200).json({ data: { snippet: this.conversions.pixelSnippet(pixelId) } });
  };

  capiEvent = async (req: Request, res: Response) => {
    const context = ctx(req);
    const payload = body(req);
    const data = await this.conversions.sendEvent({
      tenantId: context.tenantId,
      eventName: requiredString(payload.eventName, 'eventName') as any,
      eventSourceUrl: payload.eventSourceUrl,
      email: payload.email,
      phone: payload.phone,
      firstName: payload.firstName,
      lastName: payload.lastName,
      fbp: payload.fbp,
      fbc: payload.fbc,
      value: Number(payload.value || 0) || undefined,
      currency: payload.currency,
      eventId: payload.eventId,
    });
    res.status(202).json({ data, requestId: context.requestId });
  };

  webhookVerify = (req: Request, res: Response) => {
    const challenge = this.webhook.verify(req.query);
    res.status(200).send(challenge);
  };

  webhookReceive = async (req: Request, res: Response) => {
    const request = req as Request & { rawBody?: Buffer };
    const data = await this.webhook.handle({
      tenantId: typeof req.query.tenantId === 'string' ? req.query.tenantId : 'default',
      payload: body(req),
      rawBody: request.rawBody,
      signature: req.header('X-Hub-Signature-256'),
    });
    res.status(200).json({ data });
  };
}
