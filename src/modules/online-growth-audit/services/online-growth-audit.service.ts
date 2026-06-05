import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../../../errors/app-error';
import { logger } from '../../../lib/logger';
import { OnlineGrowthAuditRepository } from '../repositories/online-growth-audit.repository';
import type {
  AuditPriority,
  AuditRequest,
  AuditResult,
  AuditScore,
  AuditStatus,
  CompetitorAuditSummary,
  CrawlBundle,
  StartAuditInput,
} from '../types/online-growth-audit.types';
import {
  AEOAuditService,
  AIVisibilityAuditService,
  AIOAuditService,
  AnalyticsAuditService,
  BacklinkAuditService,
  BlogAuditService,
  ContentQualityAuditService,
  ConversionAuditService,
  FAQAuditService,
  GEOAuditService,
  GoogleBusinessAuditService,
  LeadCaptureAuditService,
  LocalSEOAuditService,
  PerformanceAuditService,
  ReviewAuditService,
  SEOAuditService,
  SecurityAuditService,
  TrustAuditService,
} from './audit-modules.service';
import { WebsiteCrawlService } from './website-crawl.service';

const startAuditSchema = z.object({
  tenantId: z.string().trim().min(1),
  name: z.string().trim().min(2).max(120),
  companyName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(180),
  websiteUrl: z.string().trim().min(3).max(500),
  competitorUrl1: z.string().trim().max(500).optional().or(z.literal('')),
  competitorUrl2: z.string().trim().max(500).optional().or(z.literal('')),
});

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUrl(rawUrl?: string): string | undefined {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return undefined;
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new BadRequestError('URL protocol wordt niet ondersteund.');
  }
  url.hash = '';
  return url.toString();
}

function scoreValue(scores: AuditScore[], key: AuditScore['key']): number | null {
  return scores.find((score) => score.key === key)?.score ?? null;
}

function averageKnownScores(scores: AuditScore[]): number | null {
  const known = scores
    .map((score) => score.score)
    .filter((score): score is number => typeof score === 'number');
  if (!known.length) return null;
  return Math.round(known.reduce((sum, score) => sum + score, 0) / known.length);
}

function buildPriorityMatrix(scores: AuditScore[]): Record<AuditPriority, string[]> {
  const matrix: Record<AuditPriority, string[]> = {
    CRITICAL: [],
    IMPORTANT: [],
    OPTIMIZATION: [],
  };

  for (const score of scores) {
    const label = score.label.replace(' Audit', '');
    if (score.score === null) {
      matrix.OPTIMIZATION.push(`${label}: koppel externe data om dit betrouwbaar te meten.`);
    } else if (score.score < 45) {
      matrix.CRITICAL.push(`${label}: ${score.recommendations[0] || 'Verbeter dit onderdeel als eerste.'}`);
    } else if (score.score < 70) {
      matrix.IMPORTANT.push(`${label}: ${score.recommendations[0] || 'Optimaliseer dit onderdeel.'}`);
    } else if (score.recommendations[0]) {
      matrix.OPTIMIZATION.push(`${label}: ${score.recommendations[0]}`);
    }
  }

  return {
    CRITICAL: matrix.CRITICAL.slice(0, 6),
    IMPORTANT: matrix.IMPORTANT.slice(0, 7),
    OPTIMIZATION: matrix.OPTIMIZATION.slice(0, 8),
  };
}

function buildQuickWins(scores: AuditScore[]): string[] {
  return scores
    .filter((score) => score.score === null || score.score < 72)
    .flatMap((score) => score.recommendations.map((item) => `${score.label}: ${item}`))
    .slice(0, 8);
}

function buildRecommendations(scores: AuditScore[]): string[] {
  return scores
    .flatMap((score) => score.recommendations)
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, 14);
}

function buildExecutiveSummary(input: {
  companyName: string;
  websiteUrl: string;
  overallScore: number | null;
  scores: AuditScore[];
}): string {
  const weakest = input.scores
    .filter((score) => typeof score.score === 'number')
    .sort((a, b) => Number(a.score) - Number(b.score))
    .slice(0, 3)
    .map((score) => score.label.replace(' Audit', '').toLowerCase());

  if (input.overallScore === null) {
    return `Voor ${input.companyName} is een audit gestart op ${input.websiteUrl}, maar er zijn onvoldoende meetbare onderdelen afgerond om een totale score te berekenen.`;
  }

  const level =
    input.overallScore >= 80
      ? 'sterke online basis'
      : input.overallScore >= 60
        ? 'redelijke basis met duidelijke groeikansen'
        : 'veel onbenutte groeikansen';

  return `${input.companyName} heeft een ${level}. De totale Online Groei Score is ${input.overallScore}/100. De belangrijkste verbetergebieden zijn ${weakest.join(', ') || 'verdere optimalisatie'}. Door vindbaarheid, vertrouwen en conversie samen te verbeteren kan de website meer aanvragen opleveren.`;
}

async function bufferFromPdf(document: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.end();
  });
}

function drawScoreBar(document: PDFKit.PDFDocument, label: string, score: number | null) {
  const x = document.x;
  const y = document.y + 3;
  const width = 250;
  document.fillColor('#0f172a').fontSize(9).text(label, x, y);
  document.roundedRect(x + 132, y, width, 8, 4).fill('#e2e8f0');
  if (score !== null) {
    document.roundedRect(x + 132, y, Math.max(4, (width * score) / 100), 8, 4).fill(
      score >= 75 ? '#22c55e' : score >= 55 ? '#2563eb' : '#f97316',
    );
    document.fillColor('#0f172a').fontSize(9).text(`${score}/100`, x + 392, y - 2);
  } else {
    document.fillColor('#64748b').fontSize(9).text('UNKNOWN', x + 392, y - 2);
  }
  document.moveDown(0.8);
}

function drawRadar(document: PDFKit.PDFDocument, scores: AuditScore[]) {
  const known = scores
    .filter((score) => typeof score.score === 'number')
    .slice(0, 8);
  if (known.length < 3) return;

  const centerX = 300;
  const centerY = document.y + 78;
  const radius = 62;
  document.save();
  document.strokeColor('#dbeafe').lineWidth(1);
  for (let ring = 1; ring <= 4; ring += 1) {
    document.circle(centerX, centerY, (radius * ring) / 4).stroke();
  }

  const points = known.map((score, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / known.length;
    const value = Number(score.score) / 100;
    const outerX = centerX + Math.cos(angle) * radius;
    const outerY = centerY + Math.sin(angle) * radius;
    document.moveTo(centerX, centerY).lineTo(outerX, outerY).stroke('#bfdbfe');
    document.fillColor('#334155').fontSize(6).text(score.label.replace(' Audit', ''), outerX - 25, outerY - 4, {
      width: 50,
      align: 'center',
    });
    return {
      x: centerX + Math.cos(angle) * radius * value,
      y: centerY + Math.sin(angle) * radius * value,
    };
  });

  document.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => document.lineTo(point.x, point.y));
  document.closePath().fillOpacity(0.18).fillAndStroke('#2563eb', '#2563eb');
  document.fillOpacity(1).restore();
  document.y = centerY + radius + 24;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(',')[1] || '';
  return Buffer.from(base64, 'base64');
}

export class OnlineGrowthAuditQueue {
  private readonly queued = new Set<string>();

  constructor(private readonly runner: (auditId: string) => Promise<void>) {}

  enqueue(auditId: string): void {
    if (this.queued.has(auditId)) return;
    this.queued.add(auditId);
    setImmediate(() => {
      this.runner(auditId)
        .catch((error) => {
          logger.error('Online growth audit job failed', {
            auditId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        })
        .finally(() => {
          this.queued.delete(auditId);
        });
    });
  }
}

export class OnlineGrowthAuditService {
  private readonly queue: OnlineGrowthAuditQueue;

  constructor(
    private readonly repository = new OnlineGrowthAuditRepository(),
    private readonly crawler = new WebsiteCrawlService(),
    private readonly seo = new SEOAuditService(),
    private readonly geo = new GEOAuditService(),
    private readonly aeo = new AEOAuditService(),
    private readonly aio = new AIOAuditService(),
    private readonly performance = new PerformanceAuditService(),
    private readonly googleBusiness = new GoogleBusinessAuditService(),
    private readonly reviews = new ReviewAuditService(),
    private readonly conversion = new ConversionAuditService(),
    private readonly security = new SecurityAuditService(),
    private readonly trust = new TrustAuditService(),
    private readonly localSeo = new LocalSEOAuditService(),
    private readonly aiVisibility = new AIVisibilityAuditService(),
    private readonly analytics = new AnalyticsAuditService(),
    private readonly blog = new BlogAuditService(),
    private readonly faq = new FAQAuditService(),
    private readonly backlink = new BacklinkAuditService(),
    private readonly leadCapture = new LeadCaptureAuditService(),
    private readonly contentQuality = new ContentQualityAuditService(),
  ) {
    this.queue = new OnlineGrowthAuditQueue((auditId) => this.runAudit(auditId));
  }

  async startAudit(input: StartAuditInput): Promise<{ auditId: string; status: AuditStatus }> {
    const parsed = startAuditSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestError('Audit aanvraag is ongeldig.', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const websiteUrl = normalizeUrl(parsed.data.websiteUrl)!;
    const competitorUrl1 = normalizeUrl(parsed.data.competitorUrl1);
    const competitorUrl2 = normalizeUrl(parsed.data.competitorUrl2);
    const now = nowIso();
    const request: AuditRequest = {
      id: crypto.randomUUID(),
      tenantId: parsed.data.tenantId,
      name: parsed.data.name,
      companyName: parsed.data.companyName,
      email: parsed.data.email,
      websiteUrl,
      competitorUrl1,
      competitorUrl2,
      status: 'PENDING',
      createdDate: now,
      updatedDate: now,
    };

    await this.repository.createRequest(request);
    this.queue.enqueue(request.id);
    return { auditId: request.id, status: request.status };
  }

  async getAudit(tenantId: string, auditId: string): Promise<{
    request: AuditRequest;
    results: AuditResult | null;
  }> {
    const request = await this.getRequiredRequest(tenantId, auditId);
    if (request.status === 'PENDING' || request.status === 'RUNNING') {
      this.queue.enqueue(auditId);
    }
    const results = await this.repository.getResult(auditId);
    return { request, results };
  }

  async listAudits(
    tenantId: string,
    status?: AuditStatus,
  ): Promise<AuditRequest[]> {
    return this.repository.listRequests({ tenantId, status });
  }

  async runAudit(auditId: string): Promise<void> {
    const request = await this.repository.getRequest(auditId);
    if (!request || request.status === 'COMPLETED') return;

    const now = nowIso();
    await this.repository.updateStatus({
      id: auditId,
      status: 'RUNNING',
      updatedDate: now,
    });

    try {
      logger.info('Online growth audit started', {
        auditId,
        tenantId: request.tenantId,
        websiteUrl: request.websiteUrl,
      });

      const bundle = await this.crawler.crawl(request.websiteUrl);
      const scores = await this.runModules(bundle);
      const competitors = await this.analyzeCompetitors([
        request.competitorUrl1,
        request.competitorUrl2,
      ]);
      const overallScore = averageKnownScores(scores);
      const priorityMatrix = buildPriorityMatrix(scores);
      const result: AuditResult = {
        auditRequestId: request.id,
        tenantId: request.tenantId,
        seoScore: scoreValue(scores, 'seo'),
        geoScore: scoreValue(scores, 'geo'),
        aeoScore: scoreValue(scores, 'aeo'),
        aioScore: scoreValue(scores, 'aio'),
        performanceScore: scoreValue(scores, 'performance'),
        securityScore: scoreValue(scores, 'security'),
        googleBusinessScore: scoreValue(scores, 'googleBusiness'),
        reviewScore: scoreValue(scores, 'reviews'),
        conversionScore: scoreValue(scores, 'conversion'),
        trustScore: scoreValue(scores, 'trust'),
        localSeoScore: scoreValue(scores, 'localSeo'),
        aiVisibilityScore: scoreValue(scores, 'aiVisibility'),
        overallScore,
        executiveSummary: buildExecutiveSummary({
          companyName: request.companyName,
          websiteUrl: request.websiteUrl,
          overallScore,
          scores,
        }),
        quickWins: buildQuickWins(scores),
        recommendations: buildRecommendations(scores),
        priorityMatrix,
        scores,
        competitors,
        pdfPath: `/api/audit/${request.id}/pdf`,
        createdDate: nowIso(),
      };

      await this.repository.putResult(result);
      await this.repository.updateStatus({
        id: auditId,
        status: 'COMPLETED',
        updatedDate: nowIso(),
        completedDate: nowIso(),
      });

      logger.info('Online growth audit completed', {
        auditId,
        tenantId: request.tenantId,
        overallScore,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Audit mislukt.';
      await this.repository.updateStatus({
        id: auditId,
        status: 'FAILED',
        updatedDate: nowIso(),
        errorMessage: message,
      });
      throw error;
    }
  }

  async generatePdf(tenantId: string, auditId: string): Promise<{
    buffer: Buffer;
    filename: string;
  }> {
    const request = await this.getRequiredRequest(tenantId, auditId);
    const result = await this.repository.getResult(auditId);
    if (!result || request.status !== 'COMPLETED') {
      throw new BadRequestError('Auditrapport is nog niet gereed.');
    }

    const document = new PDFDocument({ size: 'A4', margin: 42 });
    const qrDataUrl = await QRCode.toDataURL('https://vedantix.nl/contact', {
      margin: 1,
      width: 140,
    });
    const qrBuffer = dataUrlToBuffer(qrDataUrl);

    document
      .roundedRect(42, 36, 44, 44, 8)
      .fill('#0f172a')
      .fillColor('#ffffff')
      .fontSize(23)
      .font('Helvetica-Bold')
      .text('V', 58, 48);
    document
      .fillColor('#0f172a')
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('Vedantix Online Groei Audit', 102, 42)
      .fontSize(10)
      .fillColor('#64748b')
      .font('Helvetica')
      .text(`${request.companyName} · ${request.websiteUrl}`, 102, 68);

    document.moveDown(3);
    document
      .fillColor('#0f172a')
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(`Online Groei Score: ${result.overallScore ?? 'UNKNOWN'}/100`);
    document.moveDown(0.4);
    document
      .fillColor('#334155')
      .fontSize(10)
      .font('Helvetica')
      .text(result.executiveSummary, { lineGap: 4 });

    document.moveDown();
    document.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('Scorecards');
    document.moveDown(0.4);
    result.scores.slice(0, 12).forEach((score) => drawScoreBar(document, score.label, score.score));

    document.addPage();
    document.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold').text('Radar overzicht');
    document.moveDown(0.6);
    drawRadar(document, result.scores);

    document.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text('Prioriteitenmatrix');
    for (const [priority, items] of Object.entries(result.priorityMatrix)) {
      document.moveDown(0.5);
      document.fillColor('#2563eb').fontSize(11).font('Helvetica-Bold').text(priority);
      if (!items.length) {
        document.fillColor('#64748b').fontSize(9).font('Helvetica').text('Geen directe punten.');
      }
      items.forEach((item) => {
        document.fillColor('#334155').fontSize(9).font('Helvetica').text(`• ${item}`, {
          lineGap: 2,
        });
      });
    }

    document.addPage();
    document.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold').text('Quick wins');
    result.quickWins.forEach((item) => {
      document.moveDown(0.25);
      document.fillColor('#334155').fontSize(10).font('Helvetica').text(`• ${item}`, {
        lineGap: 3,
      });
    });

    document.moveDown();
    document.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold').text('Aanbevelingen');
    result.recommendations.forEach((item) => {
      document.moveDown(0.25);
      document.fillColor('#334155').fontSize(10).font('Helvetica').text(`• ${item}`, {
        lineGap: 3,
      });
    });

    if (result.competitors.length) {
      document.addPage();
      document.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold').text('Concurrentieanalyse');
      document.moveDown();
      result.competitors.forEach((competitor) => {
        document.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text(competitor.url);
        document
          .fillColor('#334155')
          .fontSize(9)
          .font('Helvetica')
          .text(
            `SEO ${competitor.seoScore ?? 'UNKNOWN'} · Reviews ${competitor.reviewSignals} · FAQ ${competitor.faqCount} · Speed ${competitor.speedScore ?? 'UNKNOWN'} · Google Business ${competitor.googleBusinessSignals} · Conversie ${competitor.conversionSignals}`,
          );
        document.moveDown(0.6);
      });
    }

    document.addPage();
    document
      .fillColor('#0f172a')
      .fontSize(21)
      .font('Helvetica-Bold')
      .text('Plan een vrijblijvend gesprek met Vedantix.');
    document.moveDown(0.7);
    document
      .fillColor('#334155')
      .fontSize(11)
      .font('Helvetica')
      .text('Bespreek de belangrijkste groeikansen en ontdek welke verbeteringen het meeste effect hebben op zichtbaarheid, vertrouwen en aanvragen.', {
        lineGap: 4,
      });
    document.moveDown(1);
    document.image(qrBuffer, { width: 120 });
    document.moveDown(0.8);
    document.fillColor('#2563eb').fontSize(12).font('Helvetica-Bold').text('vedantix.nl/contact');

    return {
      buffer: await bufferFromPdf(document),
      filename: `vedantix-online-groei-audit-${request.companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || request.id}.pdf`,
    };
  }

  private async getRequiredRequest(
    tenantId: string,
    auditId: string,
  ): Promise<AuditRequest> {
    const request = await this.repository.getRequest(auditId);
    if (!request || request.tenantId !== tenantId) {
      throw new NotFoundError('Audit niet gevonden.');
    }
    return request;
  }

  private async runModules(bundle: CrawlBundle): Promise<AuditScore[]> {
    const syncScores = [
      this.seo.analyze(bundle),
      this.geo.analyze(bundle),
      this.aeo.analyze(bundle),
      this.aio.analyze(bundle),
      this.analytics.analyze(bundle),
      this.blog.analyze(bundle),
      this.faq.analyze(bundle),
      this.backlink.analyze(bundle),
      this.googleBusiness.analyze(bundle),
      this.reviews.analyze(bundle),
      this.conversion.analyze(bundle),
      this.security.analyze(bundle),
      this.trust.analyze(bundle),
      this.leadCapture.analyze(bundle),
      this.localSeo.analyze(bundle),
      this.contentQuality.analyze(bundle),
      this.aiVisibility.analyze(bundle),
    ];
    const performance = await this.performance.analyze(bundle);
    return [
      syncScores[0],
      syncScores[1],
      syncScores[2],
      syncScores[3],
      performance,
      ...syncScores.slice(4),
    ];
  }

  private async analyzeCompetitors(
    urls: Array<string | undefined>,
  ): Promise<CompetitorAuditSummary[]> {
    const summaries: CompetitorAuditSummary[] = [];
    for (const rawUrl of urls.filter(Boolean)) {
      try {
        const bundle = await this.crawler.crawl(rawUrl!);
        const seoScore = this.seo.analyze(bundle).score;
        const performanceScore = (await this.performance.analyze(bundle)).score;
        summaries.push({
          url: bundle.homepage.finalUrl,
          seoScore,
          reviewSignals: bundle.pages.filter((page) => page.hasReviews || page.hasTestimonials).length,
          faqCount: bundle.pages.reduce((sum, page) => sum + page.faqCount, 0),
          speedScore: performanceScore,
          googleBusinessSignals: bundle.pages.filter((page) => page.hasGoogleMaps).length,
          conversionSignals: bundle.homepage.ctaCount +
            (bundle.homepage.hasWhatsapp ? 1 : 0) +
            (bundle.homepage.hasPhone ? 1 : 0) +
            (bundle.homepage.hasContactForm ? 1 : 0),
        });
      } catch (error) {
        summaries.push({
          url: rawUrl!,
          seoScore: null,
          reviewSignals: 0,
          faqCount: 0,
          speedScore: null,
          googleBusinessSignals: 0,
          conversionSignals: 0,
        });
      }
    }
    return summaries;
  }
}
