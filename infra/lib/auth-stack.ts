import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

export interface AuthStackProps extends StackProps {
  config: StageConfig;
  /** The site and local dev; Cognito redirects back to these after sign-in and sign-out. */
  appOrigins: string[];
}

/**
 * AuthStack (blueprint 7.2, FR-09): a Cognito user pool with the Sales, Owner and Viewer groups
 * (the API reads them from the cognito:groups claim), a browser app client using the
 * authorization-code flow with PKCE (no client secret), and the hosted sign-in domain.
 * Users are created by an admin; there is no self sign-up for a staff tool.
 */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly client: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.userPool = new cognito.UserPool(this, 'Users', {
      userPoolName: `${config.prefix}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: config.removalPolicy,
    });

    for (const [name, precedence] of [
      ['Owner', 1],
      ['Sales', 2],
      ['Viewer', 3],
    ] as const) {
      new cognito.CfnUserPoolGroup(this, `Group${name}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: name,
        precedence,
        description: `${name} role for the quote builder`,
      });
    }

    this.client = this.userPool.addClient('Web', {
      userPoolClientName: `${config.prefix}-web`,
      generateSecret: false,
      // adminUserPassword needs IAM credentials (admin tooling and smoke tests), never a browser.
      authFlows: { userSrp: true, adminUserPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: props.appOrigins.map((o) => `${o}/`),
        logoutUrls: props.appOrigins.map((o) => `${o}/`),
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
      preventUserExistenceErrors: true,
    });

    const domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: config.cognitoDomainPrefix },
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.client.userPoolClientId });
    new CfnOutput(this, 'HostedUiDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'Issuer', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`,
    });
  }
}
