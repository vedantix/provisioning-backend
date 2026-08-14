import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../../../errors/app-error';
import { logger } from '../../../lib/logger';
import { OnlineGrowthAuditRepository } from '../repositories/online-growth-audit.repository';
import type {
  AuditConfidence,
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
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!['https:', 'http:'].includes(url.protocol)) {
      throw new Error('unsupported protocol');
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  } catch {
    throw new BadRequestError('Vul een geldige publieke website-URL in.');
  }
}

function scoreValue(scores: AuditScore[], key: AuditScore['key']): number | null {
  return scores.find((score) => score.key === key)?.score ?? null;
}

const SCORE_WEIGHTS: Record<AuditScore['key'], number> = {
  seo: 15,
  geo: 5,
  aeo: 5,
  aio: 5,
  performance: 12,
  analytics: 4,
  blog: 4,
  faq: 2,
  backlink: 3,
  googleBusiness: 3,
  reviews: 4,
  conversion: 10,
  security: 12,
  trust: 7,
  leadCapture: 3,
  localSeo: 6,
  contentQuality: 9,
  aiVisibility: 6,
};

function calculateOverall(scores: AuditScore[], bundle: CrawlBundle): {
  score: number | null;
  confidence: AuditConfidence;
  measuredWeightPercent: number;
} {
  const totalWeight = scores.reduce((sum, item) => sum + SCORE_WEIGHTS[item.key], 0);
  const known = scores.filter((item) => typeof item.score === 'number' && item.status === 'COMPLETED');
  const measuredWeight = known.reduce((sum, item) => sum + SCORE_WEIGHTS[item.key], 0);
  const measuredWeightPercent = totalWeight ? Math.round((measuredWeight / totalWeight) * 100) : 0;
  const score = measuredWeight
    ? Math.round(known.reduce((sum, item) => sum + Number(item.score) * SCORE_WEIGHTS[item.key], 0) / measuredWeight)
    : null;
  const browserCoverage = bundle.pages.filter((page) => page.renderMode === 'BROWSER_RENDERED').length;
  const confidence: AuditConfidence =
    measuredWeightPercent >= 80 && bundle.pages.length >= 4 && browserCoverage >= Math.ceil(bundle.pages.length * 0.75)
      ? 'HIGH'
      : measuredWeightPercent >= 60 && bundle.homepage.renderMode !== 'STATIC_FALLBACK'
        ? 'MEDIUM'
        : 'LOW';
  return { score, confidence, measuredWeightPercent };
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
      matrix.OPTIMIZATION.push(`${label}: ${score.recommendations[0] || 'niet betrouwbaar meetbaar met alleen een websitecrawl.'}`);
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
    .filter((score) => typeof score.score === 'number' && score.score < 72)
    .sort((a, b) => Number(a.score) - Number(b.score))
    .flatMap((score) => score.recommendations.map((item) => `${score.label}: ${item}`))
    .filter((item, index, items) => items.indexOf(item) === index)
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
  confidence: AuditConfidence;
  measuredWeightPercent: number;
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

  const confidenceLabel = input.confidence === 'HIGH' ? 'hoog' : input.confidence === 'MEDIUM' ? 'gemiddeld' : 'beperkt';
  return `${input.companyName} heeft volgens de gemeten website-signalen een ${level}. De gewogen Online Groei Score is ${input.overallScore}/100, met ${confidenceLabel} meetvertrouwen en ${input.measuredWeightPercent}% van het scoregewicht daadwerkelijk gemeten. De belangrijkste verbetergebieden zijn ${weakest.join(', ') || 'verdere optimalisatie'}. Dit rapport geeft kansen aan, maar garandeert geen rankings, verkeer, leads of omzet.`;
}

function buildLimitations(bundle: CrawlBundle, scores: AuditScore[]): string[] {
  const unknown = scores.filter((score) => score.score === null).map((score) => score.label);
  return [
    `Steekproef: ${bundle.pages.length} van ${bundle.pagesAttempted} geselecteerde pagina’s geanalyseerd; dit is geen volledige sitecrawl.`,
    ...(unknown.length ? [`Niet in de totaalscore opgenomen: ${unknown.join(', ')}.`] : []),
    ...bundle.crawlWarnings,
    'Google PageSpeed is een mobiele Lighthouse-labmeting en kan per run variëren.',
    'Een websitecrawl kan geen posities, backlinks, Google Bedrijfsprofieldata, analytics-events of daadwerkelijke AI-vermeldingen bewijzen zonder gekoppelde databronnen.',
    'Scores en adviezen zijn richtinggevend en vormen geen garantie op rankings, verkeer, leads of omzet.',
  ].filter((item, index, items) => items.indexOf(item) === index).slice(0, 14);
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
  const x = document.page.margins.left;
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
    document.fillColor('#64748b').fontSize(8).text('Niet gemeten', x + 392, y - 2);
  }
  document.x = x;
  document.y = y + 17;
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

function resolveLogoPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'dist/assets/vedantix_logo.png'),
    path.resolve(process.cwd(), 'src/assets/vedantix_logo.png'),
    path.resolve(__dirname, '../../../assets/vedantix_logo.png'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function drawVedantixLogo(document: PDFKit.PDFDocument): void {
  const logoPath = resolveLogoPath();

  if (logoPath) {
    document.image(logoPath, 42, 34, {
      width: 54,
      height: 54,
    });
    return;
  }

  document
    .roundedRect(42, 36, 44, 44, 8)
    .fill('#0f172a')
    .fillColor('#ffffff')
    .fontSize(23)
    .font('Helvetica-Bold')
    .text('V', 58, 48);
}

function registerPdfFonts(document: PDFKit.PDFDocument): void {
  document.registerFont(
    'Vedantix-Regular',
    require.resolve('@fontsource/inter/files/inter-latin-500-normal.woff'),
  );
  document.registerFont(
    'Helvetica-Bold',
    require.resolve('@fontsource/inter/files/inter-latin-700-normal.woff'),
  );
}

function ensurePdfSpace(document: PDFKit.PDFDocument, requiredHeight: number): void {
  if (document.y + requiredHeight > document.page.height - 68) document.addPage();
}

function drawScoreDetails(document: PDFKit.PDFDocument, score: AuditScore): void {
  ensurePdfSpace(document, 92);
  const scoreText = score.score === null ? 'Niet gemeten' : `${score.score}/100`;
  const confidence = score.confidence === 'HIGH' ? 'hoog' : score.confidence === 'MEDIUM' ? 'gemiddeld' : 'beperkt';
  document.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text(score.label);
  document
    .fillColor(score.score === null ? '#64748b' : score.score >= 75 ? '#15803d' : score.score >= 55 ? '#1d4ed8' : '#c2410c')
    .fontSize(9)
    .text(`${scoreText} | meetvertrouwen ${confidence} | ${score.measuredChecks ?? 0}/${score.totalChecks ?? 0} controles`, { continued: false });
  document.moveDown(0.2);
  document.fillColor('#475569').fontSize(8.5).font('Vedantix-Regular').text(score.summary, { lineGap: 2 });

  const failedEvidence = (score.evidenceItems ?? []).filter((item) => item.status === 'FAIL').slice(0, 3);
  const passedEvidence = (score.evidenceItems ?? []).filter((item) => item.status === 'PASS').slice(0, 2);
  for (const item of [...failedEvidence, ...passedEvidence]) {
    ensurePdfSpace(document, 22);
    const marker = item.status === 'PASS' ? 'OK' : 'ACTIE';
    document
      .fillColor(item.status === 'PASS' ? '#15803d' : '#c2410c')
      .fontSize(7.5)
      .font('Helvetica-Bold')
      .text(`${marker} - ${item.label}: `, { continued: true })
      .fillColor('#334155')
      .font('Vedantix-Regular')
      .text(item.observed, { lineGap: 1 });
  }
  if (score.recommendations?.[0]) {
    ensurePdfSpace(document, 24);
    document.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold').text('Eerste stap: ', { continued: true });
    document.fillColor('#334155').font('Vedantix-Regular').text(score.recommendations[0], { lineGap: 1 });
  }
  document.moveDown(0.7);
}

function addPdfFooters(document: PDFKit.PDFDocument): void {
  const range = document.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    document.switchToPage(range.start + index);
    document.page.margins.bottom = 0;
    const y = document.page.height - 42;
    document
      .moveTo(42, y - 8)
      .lineTo(document.page.width - 42, y - 8)
      .strokeColor('#e2e8f0')
      .lineWidth(0.5)
      .stroke();
    document
      .fillColor('#64748b')
      .fontSize(7.5)
      .font('Vedantix-Regular')
      .text('Vedantix | info@vedantix.nl | +31 6 26 21 99 89 | vedantix.nl', 42, y, {
        width: document.page.width - 160,
        lineBreak: false,
      })
      .text(`Pagina ${index + 1} van ${range.count}`, document.page.width - 120, y, {
        width: 78,
        align: 'right',
        lineBreak: false,
      });
  }
}

export class OnlineGrowthAuditQueue {
  private readonly queued = new Set<string>();
  private readonly pending: string[] = [];
  private active = 0;

  constructor(
    private readonly runner: (auditId: string) => Promise<void>,
    private readonly concurrency = 2,
  ) {}

  enqueue(auditId: string): void {
    if (this.queued.has(auditId)) return;
    this.queued.add(auditId);
    this.pending.push(auditId);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length) {
      const auditId = this.pending.shift()!;
      this.active += 1;
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
          this.active -= 1;
          this.pump();
        });
      });
    }
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

    const websiteUrl = await this.crawler.validatePublicUrl(normalizeUrl(parsed.data.websiteUrl)!);
    const competitorUrl1 = parsed.data.competitorUrl1
      ? await this.crawler.validatePublicUrl(normalizeUrl(parsed.data.competitorUrl1)!)
      : undefined;
    const competitorUrl2 = parsed.data.competitorUrl2
      ? await this.crawler.validatePublicUrl(normalizeUrl(parsed.data.competitorUrl2)!)
      : undefined;
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
      const overall = calculateOverall(scores, bundle);
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
        overallScore: overall.score,
        overallConfidence: overall.confidence,
        measuredWeightPercent: overall.measuredWeightPercent,
        auditedUrl: request.websiteUrl,
        finalUrl: bundle.homepage.finalUrl,
        pagesAnalyzed: bundle.pages.length,
        renderedPages: bundle.pages.filter((page) => page.renderMode === 'BROWSER_RENDERED').length,
        auditVersion: '3.0',
        limitations: buildLimitations(bundle, scores),
        executiveSummary: buildExecutiveSummary({
          companyName: request.companyName,
          websiteUrl: request.websiteUrl,
          overallScore: overall.score,
          scores,
          confidence: overall.confidence,
          measuredWeightPercent: overall.measuredWeightPercent,
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
        overallScore: overall.score,
        overallConfidence: overall.confidence,
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

    const document = new PDFDocument({
      size: 'A4',
      margin: 42,
      bufferPages: true,
      info: {
        Title: `Vedantix Online Groei Audit - ${request.companyName}`,
        Author: 'Vedantix',
        Subject: 'Websitegroei, vindbaarheid, performance, security en conversie',
      },
    });
    const qrDataUrl = await QRCode.toDataURL('https://vedantix.nl/contact', {
      margin: 1,
      width: 140,
    });
    const qrBuffer = dataUrlToBuffer(qrDataUrl);

    registerPdfFonts(document);
    drawVedantixLogo(document);
    document
      .fillColor('#0f172a')
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('Vedantix Online Groei Audit', 112, 42)
      .fontSize(10)
      .fillColor('#64748b')
      .font('Vedantix-Regular')
      .text(`${request.companyName} | ${result.finalUrl || request.websiteUrl}`, 112, 68);

    document.moveDown(3);
    document
      .fillColor('#0f172a')
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(`Online Groei Score: ${result.overallScore ?? 'Niet gemeten'}${result.overallScore === null ? '' : '/100'}`);
    document
      .moveDown(0.2)
      .fillColor('#2563eb')
      .fontSize(9)
      .font('Helvetica-Bold')
      .text(`Meetvertrouwen: ${result.overallConfidence === 'HIGH' ? 'hoog' : result.overallConfidence === 'MEDIUM' ? 'gemiddeld' : 'beperkt'} | ${result.measuredWeightPercent ?? 'Onbekend'}% van het scoregewicht gemeten | ${result.pagesAnalyzed ?? 'Onbekend'} pagina’s`);
    document.moveDown(0.4);
    document
      .fillColor('#334155')
      .fontSize(10)
      .font('Vedantix-Regular')
      .text(result.executiveSummary, { lineGap: 4 });

    document.moveDown();
    document.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('Scoreoverzicht');
    document.moveDown(0.4);
    result.scores.slice(0, 10).forEach((score) => drawScoreBar(document, score.label, score.score));

    document.moveDown(0.4);
    document
      .fillColor('#64748b')
      .fontSize(8)
      .font('Vedantix-Regular')
      .text('Niet gemeten onderdelen tellen niet mee in de totaalscore. Een hogere score is geen garantie op rankings, verkeer, leads of omzet.', { lineGap: 2 });

    document.addPage();
    document.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold').text('Scoreoverzicht - vervolg');
    document.moveDown(0.4);
    result.scores.slice(10).forEach((score) => drawScoreBar(document, score.label, score.score));
    document.moveDown(0.8);
    document.fillColor('#0f172a').fontSize(15).font('Helvetica-Bold').text('Radaroverzicht');
    document.moveDown(0.6);
    drawRadar(document, result.scores);

    ensurePdfSpace(document, 80);
    document.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text('Prioriteitenmatrix');
    const priorityLabels: Record<string, string> = {
      CRITICAL: 'Kritiek',
      IMPORTANT: 'Belangrijk',
      OPTIMIZATION: 'Optimalisatie / nog te meten',
    };
    for (const [priority, items] of Object.entries(result.priorityMatrix)) {
      ensurePdfSpace(document, 38);
      document.moveDown(0.5);
      document.fillColor('#2563eb').fontSize(11).font('Helvetica-Bold').text(priorityLabels[priority] || priority);
      if (!items.length) {
        document.fillColor('#64748b').fontSize(9).font('Vedantix-Regular').text('Geen directe punten.');
      }
      items.forEach((item) => {
        ensurePdfSpace(document, 22);
        document.fillColor('#334155').fontSize(9).font('Vedantix-Regular').text(`- ${item}`, {
          lineGap: 2,
        });
      });
    }

    document.addPage();
    document.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold').text('Onderbouwing per onderdeel');
    document.moveDown(0.8);
    result.scores.forEach((score) => drawScoreDetails(document, score));

    document.addPage();
    document.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold').text('Quick wins');
    result.quickWins.forEach((item) => {
      ensurePdfSpace(document, 24);
      document.moveDown(0.25);
      document.fillColor('#334155').fontSize(10).font('Vedantix-Regular').text(`- ${item}`, {
        lineGap: 3,
      });
    });

    document.moveDown();
    document.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold').text('Aanbevelingen');
    result.recommendations.forEach((item) => {
      ensurePdfSpace(document, 24);
      document.moveDown(0.25);
      document.fillColor('#334155').fontSize(10).font('Vedantix-Regular').text(`- ${item}`, {
        lineGap: 3,
      });
    });

    ensurePdfSpace(document, 90);
    document.moveDown();
    document.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text('Meetbeperkingen');
    for (const limitation of result.limitations ?? []) {
      ensurePdfSpace(document, 22);
      document.moveDown(0.2);
      document.fillColor('#475569').fontSize(8.5).font('Vedantix-Regular').text(`- ${limitation}`, { lineGap: 2 });
    }

    if (result.competitors.length) {
      document.addPage();
      document.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold').text('Concurrentieanalyse');
      document.moveDown();
      result.competitors.forEach((competitor) => {
        ensurePdfSpace(document, 46);
        document.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text(competitor.url);
        document
          .fillColor('#334155')
          .fontSize(9)
          .font('Vedantix-Regular')
          .text(
            competitor.status === 'FAILED'
              ? `Niet geanalyseerd: ${competitor.errorMessage || 'onbekende fout'}`
              : `SEO ${competitor.seoScore ?? 'niet gemeten'} | On-site reviewsignalen ${competitor.reviewSignals ?? 'niet gemeten'} | FAQ ${competitor.faqCount ?? 'niet gemeten'} | PageSpeed ${competitor.speedScore ?? 'niet gemeten'} | Google Bedrijfsprofiel niet geverifieerd | Conversiesignalen ${competitor.conversionSignals ?? 'niet gemeten'} | ${competitor.pagesAnalyzed} pagina’s`,
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
      .font('Vedantix-Regular')
      .text('Bespreek de belangrijkste meetbare groeikansen en bepaal welke verbeteringen als eerste getest moeten worden. Vedantix geeft geen garantie op rankings, verkeer, leads of omzet.', {
        lineGap: 4,
      });
    document.moveDown(1);
    document.image(qrBuffer, { width: 120 });
    document.moveDown(0.8);
    document.fillColor('#2563eb').fontSize(12).font('Helvetica-Bold').text('vedantix.nl/contact');
    document.moveDown(0.3);
    document.fillColor('#334155').fontSize(10).font('Vedantix-Regular').text('info@vedantix.nl | +31 6 26 21 99 89');

    addPdfFooters(document);

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
          status: performanceScore === null ? 'PARTIAL' : 'COMPLETED',
          seoScore,
          reviewSignals: bundle.pages.filter((page) => page.hasReviews || page.hasTestimonials).length,
          faqCount: bundle.pages.reduce((sum, page) => sum + page.faqCount, 0),
          speedScore: performanceScore,
          googleBusinessSignals: null,
          conversionSignals: bundle.homepage.ctaCount +
            (bundle.homepage.hasWhatsapp ? 1 : 0) +
            (bundle.homepage.hasPhone ? 1 : 0) +
            (bundle.homepage.hasContactForm ? 1 : 0),
          pagesAnalyzed: bundle.pages.length,
        });
      } catch (error) {
        summaries.push({
          url: rawUrl!,
          status: 'FAILED',
          seoScore: null,
          reviewSignals: null,
          faqCount: null,
          speedScore: null,
          googleBusinessSignals: null,
          conversionSignals: null,
          pagesAnalyzed: 0,
          errorMessage: error instanceof Error ? error.message : 'Concurrent kon niet worden geanalyseerd.',
        });
      }
    }
    return summaries;
  }
}
