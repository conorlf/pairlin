import { randomBytes } from 'crypto';

const DOMAIN = process.env.PLATFORM_DOMAIN ?? 'orders.landedcost.io';

export function generateAlias(name?: string): string {
  const hash = randomBytes(4).toString('hex');
  if (name) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join('.');
    return `${slug}.${hash}@${DOMAIN}`;
  }
  return `user.${hash}@${DOMAIN}`;
}
