export type Base44CreateAppInput = {
    customerId: string;
    companyName: string;
    domain: string;
    packageCode: string;
    niche?: string;
    templateKey?: string;
    prompt: string;
  };
  
  export type Base44CreateAppResult = {
    appId: string;
    appName: string;
    editorUrl?: string;
    previewUrl?: string;
  };