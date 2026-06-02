import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { MigrationReportData } from '../types/migration.types';

function euroDate(value: string): string {
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export class MigrationReportService {
  async toPdf(report: MigrationReportData): Promise<Buffer> {
    const document = new PDFDocument({ size: 'A4', margin: 42 });
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('error', reject);
      document.on('end', () => resolve(Buffer.concat(chunks)));

      document
        .fontSize(20)
        .text('Vedantix Migratierapport', { underline: false })
        .moveDown(0.4);
      document.fontSize(10).fillColor('#64748b').text(`Gegenereerd: ${euroDate(report.generatedAt)}`);
      document.moveDown();

      document.fillColor('#0f172a').fontSize(13).text('Executive summary');
      document.fontSize(10).fillColor('#334155').text(report.executiveSummary, {
        lineGap: 3,
      });
      document.moveDown();

      document.fillColor('#0f172a').fontSize(13).text('Scores');
      document
        .fontSize(10)
        .fillColor('#334155')
        .text(`Content coverage: ${report.coverageScore}/100`)
        .text(`SEO score: ${report.seoScore}/100`)
        .text(`Pagina’s: ${report.totals.pages}`)
        .text(`Afbeeldingen: ${report.totals.images}`)
        .text(`FAQ’s: ${report.totals.faqs}`)
        .text(`CTA’s: ${report.totals.ctas}`)
        .text(`Testimonials: ${report.totals.testimonials}`);
      document.moveDown();

      if (report.missingContent.length) {
        document.fillColor('#0f172a').fontSize(13).text('Ontbrekende onderdelen');
        for (const item of report.missingContent) {
          document.fontSize(10).fillColor('#334155').text(`- ${item}`);
        }
        document.moveDown();
      }

      document.fillColor('#0f172a').fontSize(13).text('Aanbevelingen');
      for (const recommendation of report.recommendations) {
        document.fontSize(10).fillColor('#334155').text(`- ${recommendation}`, {
          lineGap: 2,
        });
      }
      document.moveDown();

      document.fillColor('#0f172a').fontSize(13).text('Pagina overzicht');
      for (const page of report.pages.slice(0, 40)) {
        document
          .fontSize(10)
          .fillColor('#0f172a')
          .text(`${page.title || page.pageUrl}`, { continued: false });
        document
          .fontSize(9)
          .fillColor('#64748b')
          .text(`${page.pageUrl} | SEO ${page.seoScore}/100 | Coverage ${page.contentCoverage}/100`);
        if (page.missingContent.length) {
          document.fontSize(9).fillColor('#64748b').text(`Mist: ${page.missingContent.join(', ')}`);
        }
        document.moveDown(0.4);
      }

      document.end();
    });
  }

  async toExcel(report: MigrationReportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Vedantix';
    workbook.created = new Date(report.generatedAt);

    const summary = workbook.addWorksheet('Samenvatting');
    summary.columns = [
      { header: 'Metric', key: 'metric', width: 28 },
      { header: 'Waarde', key: 'value', width: 60 },
    ];
    summary.addRows([
      { metric: 'Bron website', value: report.sourceUrl },
      { metric: 'Doel website', value: report.targetUrl || '' },
      { metric: 'Content coverage', value: report.coverageScore },
      { metric: 'SEO score', value: report.seoScore },
      { metric: 'Pagina’s', value: report.totals.pages },
      { metric: 'Afbeeldingen', value: report.totals.images },
      { metric: 'FAQ', value: report.totals.faqs },
      { metric: 'CTA', value: report.totals.ctas },
      { metric: 'Testimonials', value: report.totals.testimonials },
      { metric: 'Executive summary', value: report.executiveSummary },
    ]);

    const pages = workbook.addWorksheet('Pagina’s');
    pages.columns = [
      { header: 'URL', key: 'pageUrl', width: 60 },
      { header: 'Type', key: 'pageType', width: 18 },
      { header: 'Titel', key: 'title', width: 40 },
      { header: 'SEO', key: 'seoScore', width: 12 },
      { header: 'Coverage', key: 'contentCoverage', width: 12 },
      { header: 'Mist', key: 'missingContent', width: 50 },
    ];
    pages.addRows(
      report.pages.map((page) => ({
        ...page,
        missingContent: page.missingContent.join(', '),
      })),
    );

    const recommendations = workbook.addWorksheet('Aanbevelingen');
    recommendations.columns = [{ header: 'Aanbeveling', key: 'recommendation', width: 100 }];
    recommendations.addRows(
      report.recommendations.map((recommendation) => ({ recommendation })),
    );

    const images = workbook.addWorksheet('Afbeeldingen');
    images.columns = [
      { header: 'URL', key: 'imageUrl', width: 80 },
      { header: 'Alt tekst', key: 'altText', width: 40 },
      { header: 'Pagina', key: 'sourcePageUrl', width: 80 },
    ];
    images.addRows(report.images);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
