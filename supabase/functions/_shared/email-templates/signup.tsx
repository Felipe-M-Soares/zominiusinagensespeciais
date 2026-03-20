/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

const LOGO_URL = 'https://jemlaugllnwuswpkfzjy.supabase.co/storage/v1/object/public/email-assets/logo-light.png'

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Confirme seu email — Concept Usinagens Especiais</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} alt="Concept Usinagens Especiais" width="180" height="auto" style={logo} />
        <Heading style={h1}>Confirme seu email</Heading>
        <Text style={text}>
          Obrigado por se cadastrar na{' '}
          <Link href={siteUrl} style={link}>
            <strong>Concept Usinagens Especiais</strong>
          </Link>
          !
        </Text>
        <Text style={text}>
          Por favor, confirme seu endereço de email (
          <Link href={`mailto:${recipient}`} style={link}>
            {recipient}
          </Link>
          ) clicando no botão abaixo:
        </Text>
        <Button style={button} href={confirmationUrl}>
          Verificar Email
        </Button>
        <Text style={divider}>—</Text>
        <Text style={requirementsTitle}>Requisitos de senha segura</Text>
        <Text style={requirementsText}>
          Para sua segurança, sua senha deve conter:{'\n'}
          • Mínimo de 8 caracteres{'\n'}
          • Pelo menos 1 letra maiúscula (A-Z){'\n'}
          • Pelo menos 1 letra minúscula (a-z){'\n'}
          • Pelo menos 1 número (0-9){'\n'}
          • Pelo menos 1 símbolo (!@#$%^&*…)
        </Text>
        <Text style={footer}>
          Se você não criou uma conta, pode ignorar este email com segurança.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Lato', 'Inter', Arial, sans-serif" }
const container = { padding: '30px 25px' }
const logo = { margin: '0 0 24px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#171717',
  margin: '0 0 20px',
  fontFamily: "'Space Grotesk', Arial, sans-serif",
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.6',
  margin: '0 0 25px',
}
const link = { color: '#5b4cdb', textDecoration: 'underline' }
const button = {
  backgroundColor: '#5b4cdb',
  color: '#edf0ff',
  fontSize: '14px',
  borderRadius: '20px',
  padding: '12px 24px',
  textDecoration: 'none',
  fontWeight: 'bold' as const,
}
const divider = { fontSize: '14px', color: '#cccccc', textAlign: 'center' as const, margin: '30px 0 10px' }
const requirementsTitle = {
  fontSize: '13px',
  fontWeight: 'bold' as const,
  color: '#171717',
  margin: '0 0 8px',
}
const requirementsText = {
  fontSize: '13px',
  color: '#55575d',
  lineHeight: '1.8',
  margin: '0 0 20px',
  whiteSpace: 'pre-line' as const,
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
