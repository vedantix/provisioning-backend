import { mailConfig } from '../../../config/mail.config';
import type { MailProvider } from './mail-provider.interface';
import { ZohoMailProvider } from './zoho-mail.provider';
import { MigaduMailProvider } from './migadu-mail.provider';

export function createMailProvider(): MailProvider {
  switch ((mailConfig.provider || 'ZOHO').toUpperCase()) {
    case 'MIGADU':
      return new MigaduMailProvider();
    case 'ZOHO':
    default:
      return new ZohoMailProvider();
  }
}
