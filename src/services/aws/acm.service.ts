import {
  ACMClient,
  RequestCertificateCommand,
  DescribeCertificateCommand,
  DeleteCertificateCommand
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

export async function waitForCertificateIssued(
  certificateArn: string,
  maxAttempts = 40,
  delayMs = 15000
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await getCertificateStatus(certificateArn);

    console.log(`[ACM] Certificate status attempt ${attempt}: ${status}`);

    if (status === 'ISSUED') {
      return;
    }

    if (status === 'FAILED' || status === 'EXPIRED' || status === 'REVOKED') {
      throw new Error(`Certificate moved to terminal status: ${status}`);
    }

    await sleep(delayMs);
  }

  throw new Error('Timed out waiting for ACM certificate to become ISSUED');
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function deleteCertificateIfExists(params: {
  certificateArn: string;
}): Promise<{
  certificateArn: string;
  deleted: boolean;
}> {
  try {
    await acm.send(
      new DeleteCertificateCommand({
        CertificateArn: params.certificateArn
      })
    );

    return {
      certificateArn: params.certificateArn,
      deleted: true
    };
  } catch (error: any) {
    const code = error?.name || error?.Code;

    if (code === 'ResourceNotFoundException') {
      return {
        certificateArn: params.certificateArn,
        deleted: false
      };
    }

    throw error;
  }
}