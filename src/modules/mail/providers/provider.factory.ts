import type { MailProvider } from './mail-provider.interface';
import { MigaduMailProvider } from './migadu-mail.provider';

export function createMailProvider(): MailProvider {
  return new MigaduMailProvider();
}
