import { OAuth2Client } from 'google-auth-library';
import { verifyPassword } from '../../platform/crypto.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { AuthService, LoginResult, ReqMeta } from './auth.service.js';

export interface GoogleProfile {
  /** Google's stable, never-reused account identifier. The only identity key we trust. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface GoogleVerifier {
  /** Throws on any invalid token. Never accepts a client-supplied profile. */
  verify(idToken: string): Promise<GoogleProfile>;
}

/**
 * Verifies a Google Identity Services ID token with google-auth-library, which checks the
 * signature against Google's published keys, `aud`, `exp` and `iss`
 * (https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
 */
export class GoogleIdTokenVerifier implements GoogleVerifier {
  private readonly client = new OAuth2Client();
  constructor(private readonly clientId: string) {}

  async verify(idToken: string): Promise<GoogleProfile> {
    let payload;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
      payload = ticket.getPayload();
    } catch {
      throw AppError.unauthenticated('Google sign-in could not be verified');
    }
    if (!payload?.sub || !payload.email)
      throw AppError.unauthenticated('Google sign-in could not be verified');
    return {
      sub: payload.sub,
      email: payload.email.trim().toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: payload.name ?? payload.email,
    };
  }
}

export class GoogleAuthService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly verifier: GoogleVerifier,
  ) {}

  /**
   * Sign in / sign up with Google.
   * - Known Google subject: sign in that user.
   * - Unknown subject, email unused: create a verified, password-less account.
   * - Unknown subject, email belongs to an UNVERIFIED password account: the registrant never proved
   *   ownership, so Google's verified email takes the account over and the squatter's password is
   *   removed (pre-hijacking defence).
   * - Unknown subject, email belongs to a VERIFIED account: never auto-link. The owner must sign in
   *   and link from account settings.
   * Google authentication grants no tenant or administrative access by itself.
   */
  async signIn(idToken: string, meta: ReqMeta): Promise<LoginResult> {
    const profile = await this.verifier.verify(idToken);
    if (!profile.emailVerified)
      throw AppError.unauthenticated('Your Google email address is not verified');

    const identity = await this.db.authIdentity.findUnique({
      where: { provider_subject: { provider: 'GOOGLE', subject: profile.sub } },
      include: { user: true },
    });
    if (identity) {
      if (identity.user.status !== 'ACTIVE')
        throw AppError.forbidden('This account is unavailable');
      return this.auth.completeLogin(identity.userId, 'google', meta);
    }

    const existing = await this.db.user.findUnique({ where: { email: profile.email } });
    if (existing?.emailVerifiedAt) {
      await writeAudit(this.db, {
        action: 'auth.google_link_required',
        outcome: 'DENIED',
        actorUserId: existing.id,
        requestId: meta.requestId,
      });
      throw AppError.conflict(
        'An account with this email already exists. Sign in with your password, then link Google in account settings.',
      );
    }

    let userId: string;
    if (existing) {
      await this.db.$transaction([
        this.db.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: null,
            emailVerifiedAt: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
          },
        }),
        this.db.session.updateMany({
          where: { userId: existing.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        this.db.authIdentity.create({
          data: { userId: existing.id, provider: 'GOOGLE', subject: profile.sub },
        }),
      ]);
      userId = existing.id;
    } else {
      const created = await this.db.user.create({
        data: {
          email: profile.email,
          displayName: profile.name.slice(0, 100),
          emailVerifiedAt: new Date(),
          identities: { create: { provider: 'GOOGLE', subject: profile.sub } },
        },
      });
      userId = created.id;
    }
    await writeAudit(this.db, {
      action: existing ? 'auth.google_claimed_unverified' : 'auth.google_signup',
      outcome: 'SUCCESS',
      actorUserId: userId,
      requestId: meta.requestId,
    });
    return this.auth.completeLogin(userId, 'google', meta);
  }

  /** Link Google to the signed-in account. Users with a password must re-enter it. */
  async link(userId: string, idToken: string, currentPassword: string | undefined, meta: ReqMeta) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (
      user.passwordHash &&
      !(currentPassword && (await verifyPassword(user.passwordHash, currentPassword)))
    ) {
      throw AppError.forbidden('Password is incorrect');
    }
    const profile = await this.verifier.verify(idToken);
    if (!profile.emailVerified)
      throw AppError.unauthenticated('Your Google email address is not verified');

    const taken = await this.db.authIdentity.findUnique({
      where: { provider_subject: { provider: 'GOOGLE', subject: profile.sub } },
    });
    if (taken) {
      if (taken.userId === userId) return;
      throw AppError.conflict('This Google account is already linked to another user');
    }
    await this.db.authIdentity.create({
      data: { userId, provider: 'GOOGLE', subject: profile.sub },
    });
    await writeAudit(this.db, {
      action: 'auth.google_linked',
      outcome: 'SUCCESS',
      actorUserId: userId,
      requestId: meta.requestId,
    });
  }
}
