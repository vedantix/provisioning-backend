export function generateIndexHtml(domain: string) {
    return `<!DOCTYPE html>
  <html>
  <head>
    <title>${domain}</title>
  </head>
  <body>
    <h1>Welkom bij ${domain}</h1>
  </body>
  </html>`;
  }
  
  export function generatePackageJson() {
    return JSON.stringify({
      name: "customer-site",
      private: true,
      scripts: {
        build: "echo build"
      }
    }, null, 2);
  }