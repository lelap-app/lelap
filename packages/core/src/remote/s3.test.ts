import { describe, expect, it } from 'vitest';

import { listS3, objectUrl, parseS3Uri, presignGet, type S3Source } from './s3';

// The example from AWS's documentation of query-string authentication.
const AWS_EXAMPLE: S3Source = {
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  bucket: 'examplebucket',
  prefix: '',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

describe('S3', () => {
  it("pre-signs like AWS's own example", () => {
    const url = presignGet(AWS_EXAMPLE, 'test.txt', Date.parse('2013-05-24T00:00:00Z'), 86400);
    expect(url).toContain('https://examplebucket.s3.amazonaws.com/test.txt?');
    expect(url).toContain(
      'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('uses path-style URLs off AWS and encodes keys', () => {
    const minio = { ...AWS_EXAMPLE, endpoint: 'https://minio.example.org/', bucket: 'books' };
    expect(objectUrl(minio, 'Dune/01 Part (one).mp3').href).toBe(
      'https://minio.example.org/books/Dune/01%20Part%20%28one%29.mp3',
    );
    expect(parseS3Uri('s3://books/Dune/01.mp3')).toEqual({ bucket: 'books', key: 'Dune/01.mp3' });
  });

  it('lists every page below the prefix as library files', async () => {
    const pages = [
      `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>t2</NextContinuationToken>
        <Contents><Key>audio/Dune/</Key><Size>0</Size></Contents>
        <Contents><Key>audio/Dune/01.mp3</Key><Size>100</Size><LastModified>2026-01-02T00:00:00Z</LastModified></Contents>
      </ListBucketResult>`,
      `<ListBucketResult><IsTruncated>false</IsTruncated>
        <Contents><Key>audio/Dune/02.mp3</Key><Size>200</Size></Contents></ListBucketResult>`,
    ];
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      return new Response(pages[urls.length - 1]);
    };
    const source = {
      ...AWS_EXAMPLE,
      endpoint: 'https://r2.example.org',
      bucket: 'books',
      prefix: 'audio/',
    };
    const files = await listS3(fetcher, source, 0);
    expect(files.map((f) => [f.relPath, f.location, f.uri, f.size])).toEqual([
      ['Dune/01.mp3', 's3:books/audio/Dune/01.mp3', 's3://books/audio/Dune/01.mp3', 100],
      ['Dune/02.mp3', 's3:books/audio/Dune/02.mp3', 's3://books/audio/Dune/02.mp3', 200],
    ]);
    expect(urls[1]).toContain('continuation-token=t2');
  });
});
