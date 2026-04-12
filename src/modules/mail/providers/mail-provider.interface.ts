import type {
    CreateMailboxInput,
    ProviderDomainDetails,
    ProviderDomainResult,
    ProviderMailboxResult,
  } from '../types/mail.types';
  
  export interface MailProvider {
    createDomain(domain: string): Promise<ProviderDomainResult>;
    getDomain(domain: string): Promise<ProviderDomainDetails>;
    getDomainDnsRecords(domain: string): Promise<ProviderDomainDetails>;
    createMailbox(input: {
      domain: string;
      localPart: string;
      displayName: string;
      password?: string;
    }): Promise<ProviderMailboxResult>;
    disableMailbox(input: { email: string }): Promise<void>;
    enableMailbox(input: { email: string }): Promise<void>;
    deleteMailbox(input: { email: string }): Promise<void>;
  }