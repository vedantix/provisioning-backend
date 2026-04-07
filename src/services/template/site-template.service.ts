export function generateIndexHtml(domain: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1"
    />
    <title>${domain} | Vedantix Deployment</title>
    <meta
      name="description"
      content="Starter website provisioned automatically by Vedantix for ${domain}."
    />
    <style>
      :root {
        color-scheme: light dark;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: Inter, Arial, sans-serif;
        line-height: 1.5;
        background: #0f172a;
        color: #e5e7eb;
      }

      .wrap {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px;
      }

      .card {
        width: 100%;
        max-width: 760px;
        background: rgba(15, 23, 42, 0.88);
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 20px;
        padding: 32px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
      }

      .badge {
        display: inline-block;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(59, 130, 246, 0.14);
        color: #93c5fd;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      h1 {
        margin: 18px 0 12px;
        font-size: clamp(32px, 5vw, 52px);
        line-height: 1.05;
      }

      p {
        margin: 0 0 16px;
        color: #cbd5e1;
        font-size: 16px;
      }

      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        margin-top: 28px;
      }

      .item {
        padding: 18px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(148, 163, 184, 0.12);
      }

      .item h2 {
        margin: 0 0 10px;
        font-size: 18px;
      }

      .domain {
        margin-top: 24px;
        font-size: 14px;
        color: #94a3b8;
        word-break: break-word;
      }

      a {
        color: #93c5fd;
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="card">
        <span class="badge">Vedantix Provisioning</span>
        <h1>${domain} is live.</h1>
        <p>
          This starter website was provisioned automatically by Vedantix.
        </p>
        <p>
          Infrastructure, DNS, certificate handling, and deployment flow are in place.
          You can now replace this starter page with the real project output.
        </p>

        <div class="grid">
          <article class="item">
            <h2>Fast delivery</h2>
            <p>
              The repository, workflow, and hosting pipeline were generated automatically.
            </p>
          </article>

          <article class="item">
            <h2>Secure by default</h2>
            <p>
              The site is intended to run behind CloudFront with managed DNS and ACM.
            </p>
          </article>

          <article class="item">
            <h2>Ready to customize</h2>
            <p>
              Replace this page, add real assets, and keep using the same deploy workflow.
            </p>
          </article>
        </div>

        <p class="domain">
          Domain: <strong>${domain}</strong>
        </p>
      </section>
    </main>
  </body>
</html>`;
}

export function generatePackageJson(): string {
  return JSON.stringify(
    {
      name: 'customer-site',
      private: true,
      version: '1.0.0',
      scripts: {
        build: 'node scripts/build.js',
      },
    },
    null,
    2,
  );
}

export function generateBuildScript(): string {
  return `const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const sourceFiles = ['index.html'];

for (const file of sourceFiles) {
  const from = path.join(rootDir, file);
  const to = path.join(distDir, file);

  if (!fs.existsSync(from)) {
    throw new Error(\`Missing source file: \${file}\`);
  }

  fs.copyFileSync(from, to);
}

console.log('Build completed. Files copied to dist/.');
`;
}