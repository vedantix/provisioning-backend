export type MetaEntityType =
  | 'CONNECTION'
  | 'CAMPAIGN'
  | 'AD_SET'
  | 'AD'
  | 'CREATIVE'
  | 'LEAD'
  | 'INSIGHT'
  | 'AUDIENCE'
  | 'RECOMMENDATION'
  | 'AUDIT';

export type MetaConnectionStatus =
  | 'NOT_CONNECTED'
  | 'CONNECTED'
  | 'RECONNECT_REQUIRED'
  | 'FAILED';

export type MetaCampaignStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ARCHIVED';

export type MetaLeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'QUALIFIED'
  | 'PROPOSAL_SENT'
  | 'WON'
  | 'LOST';

export type MetaCreativeType = 'IMAGE' | 'VIDEO';

export type MetaPlacement =
  | 'facebook_feed'
  | 'instagram_feed'
  | 'facebook_stories'
  | 'instagram_stories'
  | 'facebook_reels'
  | 'instagram_reels'
  | 'audience_network';

export type MetaMoney = {
  amount: number;
  currency: string;
};

export type MetaTargeting = {
  ageMin?: number;
  ageMax?: number;
  genders?: Array<'male' | 'female' | 'all'>;
  countries?: string[];
  regions?: string[];
  cities?: string[];
  interests?: Array<{ id?: string; name: string }>;
  customAudiences?: string[];
  placements?: MetaPlacement[];
};

export type MetaBaseRecord = {
  pk: string;
  sk: string;
  entityType: MetaEntityType;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: string;
};

export type MetaConnectionRecord = MetaBaseRecord & {
  entityType: 'CONNECTION';
  connectionId: 'vedantix-internal';
  status: MetaConnectionStatus;
  encryptedAccessToken?: string;
  tokenExpiresAt?: string;
  tokenScopes: string[];
  businessId?: string;
  businessName?: string;
  adAccountId?: string;
  adAccountName?: string;
  pageId?: string;
  pageName?: string;
  instagramId?: string;
  instagramUsername?: string;
  pixelId?: string;
  lastValidatedAt?: string;
  errorMessage?: string;
};

export type MetaCampaignRecord = MetaBaseRecord & {
  entityType: 'CAMPAIGN';
  campaignId: string;
  metaCampaignId?: string;
  name: string;
  objective: string;
  status: MetaCampaignStatus;
  buyingType: 'AUCTION' | 'RESERVED';
  dailyBudget?: MetaMoney;
  monthlyBudget?: MetaMoney;
  revenue?: number;
  notes?: string;
  lastSyncedAt?: string;
};

export type MetaAdSetRecord = MetaBaseRecord & {
  entityType: 'AD_SET';
  adSetId: string;
  metaAdSetId?: string;
  campaignId: string;
  name: string;
  status: MetaCampaignStatus;
  dailyBudget?: MetaMoney;
  startTime?: string;
  endTime?: string;
  optimizationGoal: string;
  billingEvent: string;
  bidStrategy?: string;
  targeting: MetaTargeting;
  lastSyncedAt?: string;
};

export type MetaCreativeRecord = MetaBaseRecord & {
  entityType: 'CREATIVE';
  creativeId: string;
  metaCreativeId?: string;
  metaAssetId?: string;
  type: MetaCreativeType;
  name: string;
  imageUrl?: string;
  videoUrl?: string;
  landingPageUrl: string;
  headline: string;
  description?: string;
  primaryText: string;
  callToAction: string;
  lastSyncedAt?: string;
};

export type MetaAdRecord = MetaBaseRecord & {
  entityType: 'AD';
  adId: string;
  metaAdId?: string;
  adSetId: string;
  creativeId: string;
  name: string;
  status: MetaCampaignStatus;
  previewUrl?: string;
  lastSyncedAt?: string;
};

export type MetaLeadActivity = {
  activityId: string;
  type: 'NOTE' | 'TASK' | 'CALL' | 'WHATSAPP' | 'EMAIL';
  text: string;
  dueAt?: string;
  completedAt?: string;
  createdAt: string;
  createdBy?: string;
};

export type MetaLeadRecord = MetaBaseRecord & {
  entityType: 'LEAD';
  leadId: string;
  metaLeadId?: string;
  status: MetaLeadStatus;
  name?: string;
  email?: string;
  phone?: string;
  sourceCampaignId?: string;
  sourceCampaignName?: string;
  sourceAdSetId?: string;
  sourceAdId?: string;
  sourcePlatform?: string;
  dealValue?: number;
  revenue?: number;
  wonAt?: string;
  lostReason?: string;
  activities: MetaLeadActivity[];
};

export type MetaInsightRecord = MetaBaseRecord & {
  entityType: 'INSIGHT';
  insightId: string;
  level: 'account' | 'campaign' | 'adset' | 'ad';
  sourceId?: string;
  dateStart: string;
  dateStop: string;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  cpc: number;
  ctr: number;
  cpm: number;
  leads: number;
  conversions: number;
  raw?: Record<string, unknown>;
};

export type MetaAudienceRecord = MetaBaseRecord & {
  entityType: 'AUDIENCE';
  audienceId: string;
  name: string;
  targeting: MetaTargeting;
};

export type MetaRecommendationRecord = MetaBaseRecord & {
  entityType: 'RECOMMENDATION';
  recommendationId: string;
  title: string;
  explanation: string;
  action: 'INCREASE_BUDGET' | 'DECREASE_BUDGET' | 'PAUSE_CAMPAIGN' | 'DUPLICATE_CAMPAIGN' | 'CHANGE_AUDIENCE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  relatedCampaignId?: string;
  status: 'OPEN' | 'DISMISSED' | 'APPLIED';
};

export type MetaAuditRecord = MetaBaseRecord & {
  entityType: 'AUDIT';
  auditId: string;
  action: string;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
};

export type MetaEntityRecord =
  | MetaConnectionRecord
  | MetaCampaignRecord
  | MetaAdSetRecord
  | MetaAdRecord
  | MetaCreativeRecord
  | MetaLeadRecord
  | MetaInsightRecord
  | MetaAudienceRecord
  | MetaRecommendationRecord
  | MetaAuditRecord;

export type MetaDashboardSummary = {
  spend: number;
  leads: number;
  qualifiedLeads: number;
  customers: number;
  revenue: number;
  profit: number;
  roas: number;
  cpl: number;
  cac: number;
  customerConversionRate: number;
  activeCampaigns: number;
  charts: {
    spend: Array<{ date: string; value: number }>;
    leads: Array<{ date: string; value: number }>;
    revenue: Array<{ date: string; value: number }>;
    profit: Array<{ date: string; value: number }>;
    roas: Array<{ date: string; value: number }>;
  };
};
