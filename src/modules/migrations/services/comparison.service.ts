import type {
  MigrationImportPayload,
  MigrationPageRecord,
  MigrationRecord,
  MigrationReportData,
} from '../types/migration.types';

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function pageSlug(page: MigrationPageRecord): string {
  const normalized = String(page.pathname || '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  return normalized || 'home';
}

function compactUnique(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || '').trim()).filter(Boolean)),
  );
}

export class ComparisonService {
  summarizeMigration(
    migration: MigrationRecord,
    pages: MigrationPageRecord[],
  ): Pick<MigrationRecord, 'counts' | 'seoScore' | 'coverageScore'> {
    return {
      counts: {
        pages: pages.length,
        images: compactUnique(pages.flatMap((page) => page.images.map((image) => image.imageUrl))).length,
        faqs: pages.reduce((sum, page) => sum + page.faqs.length, 0),
        testimonials: pages.reduce((sum, page) => sum + page.testimonials.length, 0),
        ctas: pages.reduce((sum, page) => sum + page.ctas.length, 0),
      },
      seoScore: average(pages.map((page) => page.seoScore)),
      coverageScore: average(pages.map((page) => page.contentCoverage)),
    };
  }

  buildReportData(
    migration: MigrationRecord,
    pages: MigrationPageRecord[],
  ): MigrationReportData {
    const missingContent = compactUnique(pages.flatMap((page) => page.missingContent));
    const recommendations = this.buildRecommendations(migration, pages, missingContent);

    return {
      executiveSummary: this.buildSummary(migration, pages, missingContent),
      sourceUrl: migration.sourceUrl,
      targetUrl: migration.targetUrl,
      totals: migration.counts,
      seoScore: migration.seoScore,
      coverageScore: migration.coverageScore,
      missingContent,
      pages: pages.map((page) => ({
        pageId: page.pageId,
        pageUrl: page.pageUrl,
        pageType: page.pageType,
        title: page.title,
        seoScore: page.seoScore,
        contentCoverage: page.contentCoverage,
        missingContent: page.missingContent,
      })),
      images: pages.flatMap((page) => page.images),
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  buildImportPayload(
    migration: MigrationRecord,
    pages: MigrationPageRecord[],
  ): MigrationImportPayload {
    return {
      generatedAt: new Date().toISOString(),
      sourceUrl: migration.sourceUrl,
      targetUrl: migration.targetUrl,
      pages: pages.map((page) => {
        const improvement = page.aiImprovement;
        const title =
          improvement?.improvedSeoTitle ||
          page.title ||
          page.h1 ||
          pageSlug(page).replace(/-/g, ' ');
        const description =
          improvement?.improvedSeoDescription ||
          page.description ||
          improvement?.heroSubtitle ||
          '';

        return {
          slug: pageSlug(page),
          title,
          hero: {
            title: improvement?.heroTitle || page.h1 || title,
            subtitle: improvement?.heroSubtitle || page.description,
          },
          sections:
            improvement?.improvedSections?.length
              ? improvement.improvedSections
              : page.sections,
          faqs: page.faqs,
          ctas:
            improvement?.recommendedCtas?.length
              ? improvement.recommendedCtas
              : page.ctas,
          seo: {
            title,
            description,
            openGraphTitle: title,
            openGraphDescription: description,
          },
        };
      }),
    };
  }

  private buildSummary(
    migration: MigrationRecord,
    pages: MigrationPageRecord[],
    missingContent: string[],
  ): string {
    const pageText = pages.length === 1 ? 'pagina' : 'pagina’s';
    const scoreText = `${migration.coverageScore}/100 contentdekking en ${migration.seoScore}/100 SEO`;
    const missingText = missingContent.length
      ? `Belangrijkste ontbrekende onderdelen: ${missingContent.join(', ')}.`
      : 'Er zijn geen grote contentgaten gevonden.';

    return `De scan van ${migration.sourceUrl} vond ${pages.length} ${pageText}. De huidige analyse geeft ${scoreText}. ${missingText}`;
  }

  private buildRecommendations(
    migration: MigrationRecord,
    pages: MigrationPageRecord[],
    missingContent: string[],
  ): string[] {
    const recommendations: string[] = [];
    if (migration.seoScore < 70) {
      recommendations.push('Verbeter title tags en meta descriptions voor de belangrijkste pagina’s.');
    }
    if (missingContent.includes('CTA blok')) {
      recommendations.push('Voeg duidelijke CTA blokken toe op pagina’s zonder conversieactie.');
    }
    if (missingContent.includes('FAQ')) {
      recommendations.push('Migreer of schrijf FAQ’s om long-tail zoekvragen beter af te vangen.');
    }
    if (missingContent.includes('Testimonials')) {
      recommendations.push('Neem bestaande reviews of referenties mee in de nieuwe website.');
    }
    if (pages.some((page) => page.images.some((image) => !image.altText))) {
      recommendations.push('Vul ontbrekende alt-teksten aan voor afbeeldingen.');
    }
    if (recommendations.length === 0) {
      recommendations.push('Gebruik de geëxtraheerde content als basis voor de nieuwe Vedantix website.');
    }
    return recommendations;
  }
}
