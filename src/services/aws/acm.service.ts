import {
  ACMClient,
  RequestCertificateCommand,
  DescribeCertificateCommand,
  DeleteCertificateCommand,
  CertificateStatus,
} from "@aws-sdk/client-acm";
import { env } from "../../config/env";

const acm = new ACMClient({ region: env.awsAcmRegion });

export type CertificateValidationRecord = {
  domainName: string;
  validationDomain?: string;
  validationStatus?: string;
  name: string;
  type: string;
  value: string;
};

export type CertificateDescribeSummary = {
  certificateArn: string;
  status: string;
  domainName?: string;
  subjectAlternativeNames: string[];
  validationRecords: CertificateValidationRecord[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestCertificate(
  domainName: string,
  subjectAlternativeNames: string[] = []
): Promise<string> {
  const sanitizedSans = [...new Set(subjectAlternativeNames.filter(Boolean))];

  const result = await acm.send(
    new RequestCertificateCommand({
      DomainName: domainName,
      SubjectAlternativeNames: sanitizedSans,
      ValidationMethod: "DNS",
      Tags: [
        { Key: "managed-by", Value: "vedantix" },
        { Key: "type", Value: "customer-certificate" },
      ],
    })
  );

  if (!result.CertificateArn) {
    throw new Error(`Failed to request certificate for domain: ${domainName}`);
  }

  return result.CertificateArn;
}

export async function describeCertificate(
  certificateArn: string
): Promise<CertificateDescribeSummary> {
  const result = await acm.send(
    new DescribeCertificateCommand({
      CertificateArn: certificateArn,
    })
  );

  const certificate = result.Certificate;

  if (!certificate) {
    throw new Error(`Certificate not found for ARN: ${certificateArn}`);
  }

  const validationRecords: CertificateValidationRecord[] = [];

  for (const option of certificate.DomainValidationOptions ?? []) {
    const resourceRecord = option.ResourceRecord;

    if (
      !option.DomainName ||
      !resourceRecord?.Name ||
      !resourceRecord?.Type ||
      !resourceRecord?.Value
    ) {
      continue;
    }

    validationRecords.push({
      domainName: option.DomainName,
      validationDomain: option.ValidationDomain,
      validationStatus: option.ValidationStatus,
      name: resourceRecord.Name,
      type: resourceRecord.Type,
      value: resourceRecord.Value,
    });
  }

  return {
    certificateArn,
    status: certificate.Status ?? "UNKNOWN",
    domainName: certificate.DomainName,
    subjectAlternativeNames: certificate.SubjectAlternativeNames ?? [],
    validationRecords,
  };
}

export async function getCertificateValidationRecords(
  certificateArn: string
): Promise<CertificateValidationRecord[]> {
  const summary = await describeCertificate(certificateArn);
  return summary.validationRecords;
}

export async function getCertificateStatus(
  certificateArn: string
): Promise<string> {
  const summary = await describeCertificate(certificateArn);
  return summary.status;
}

export async function waitForCertificateIssued(
  certificateArn: string,
  maxAttempts = 40,
  delayMs = 15000
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const summary = await describeCertificate(certificateArn);
    const status = summary.status;

    console.log(
      `[ACM] Certificate status attempt ${attempt}: ${status} | arn=${certificateArn}`
    );

    if (summary.validationRecords.length > 0) {
      for (const record of summary.validationRecords) {
        console.log(
          `[ACM] Validation record | domain=${record.domainName} | status=${record.validationStatus ?? "UNKNOWN"} | type=${record.type} | name=${record.name} | value=${record.value}`
        );
      }
    } else {
      console.log(
        `[ACM] No validation records available yet for certificate ${certificateArn}`
      );
    }

    if (status === CertificateStatus.ISSUED || status === "ISSUED") {
      return;
    }

    if (
      status === CertificateStatus.FAILED ||
      status === CertificateStatus.EXPIRED ||
      status === CertificateStatus.REVOKED ||
      status === "FAILED" ||
      status === "EXPIRED" ||
      status === "REVOKED"
    ) {
      throw new Error(
        `Certificate moved to terminal status: ${status} (arn=${certificateArn})`
      );
    }

    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }

  const finalSummary = await describeCertificate(certificateArn);

  throw new Error(
    [
      `Timed out waiting for ACM certificate to become ISSUED.`,
      `arn=${certificateArn}`,
      `finalStatus=${finalSummary.status}`,
      `domains=${[
        finalSummary.domainName,
        ...finalSummary.subjectAlternativeNames,
      ]
        .filter(Boolean)
        .join(",")}`,
      `validationRecords=${JSON.stringify(finalSummary.validationRecords)}`,
    ].join(" ")
  );
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
        CertificateArn: params.certificateArn,
      })
    );

    return {
      certificateArn: params.certificateArn,
      deleted: true,
    };
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null
        ? (error as { name?: string; Code?: string }).name ??
          (error as { name?: string; Code?: string }).Code
        : undefined;

    if (code === "ResourceNotFoundException") {
      return {
        certificateArn: params.certificateArn,
        deleted: false,
      };
    }

    throw error;
  }
}