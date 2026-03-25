import {
  ACMClient,
  RequestCertificateCommand,
  DescribeCertificateCommand
} from '@aws-sdk/client-acm';
import { env } from '../../config/env';

const acm = new ACMClient({ region: env.awsAcmRegion });

export async function requestCertificate(
  domainName: string,
  subjectAlternativeNames: string[] = []
) {
  const result = await acm.send(
    new RequestCertificateCommand({
      DomainName: domainName,
      SubjectAlternativeNames: subjectAlternativeNames,
      ValidationMethod: 'DNS',
      Tags: [
        { Key: 'managed-by', Value: 'vedantix' },
        { Key: 'type', Value: 'customer-certificate' }
      ]
    })
  );

  if (!result.CertificateArn) {
    throw new Error(`Failed to request certificate for domain: ${domainName}`);
  }

  return result.CertificateArn;
}

export async function getCertificateValidationRecords(certificateArn: string) {
  const result = await acm.send(
    new DescribeCertificateCommand({
      CertificateArn: certificateArn
    })
  );

  return (result.Certificate?.DomainValidationOptions ?? [])
    .map(option => option.ResourceRecord)
    .filter((record): record is NonNullable<typeof record> => Boolean(record))
    .map(record => ({
      name: record.Name ?? '',
      type: record.Type ?? 'CNAME',
      value: record.Value ?? ''
    }))
    .filter(record => record.name && record.type && record.value);
}

export async function getCertificateStatus(certificateArn: string) {
  const result = await acm.send(
    new DescribeCertificateCommand({
      CertificateArn: certificateArn
    })
  );

  return result.Certificate?.Status ?? 'UNKNOWN';
}