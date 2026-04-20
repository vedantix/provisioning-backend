export type ContentSyncFileInput = {
    path: string;
    content: string;
    encoding?: 'utf-8' | 'base64';
  };
  
  export type SyncCustomerContentInput = {
    customerId: string;
    tenantId: string;
    actorId: string;
    projectId?: string;
    indexHtml: string;
    additionalFiles?: ContentSyncFileInput[];
  };
  
  export type SyncCustomerContentResult = {
    repositoryName: string;
    branch: string;
    filesCount: number;
  };