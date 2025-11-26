import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const inter = Inter({ subsets: ["latin"] });

// 배포 환경에 따라 동적으로 설정 (Vercel 등 호스팅 플랫폼 환경 변수 활용)
const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000');

const agentName = "A2A Agent Builder";
const description = "Build and deploy your own AI agents with A2A Protocol. Create evolving agents that balance Thinking and Caring.";
// const imageUrl = `${baseUrl}/agent-card-image.png`; // 이미지 사용 시 주석 해제

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: agentName,
  description: description,
  // Open Graph 설정 (에이전트 카드 시각적 미리보기용)
  openGraph: {
    title: agentName,
    description: description,
    url: baseUrl,
    siteName: agentName,
    /* 이미지 사용 시 주석 해제
    images: [
      {
        url: imageUrl,
        width: 1200,
        height: 630,
        alt: 'Socrates Web3 AI Tutor Agent Card',
      },
    ],
    */
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: agentName,
    description: description,
    // images: [imageUrl], // 이미지 사용 시 주석 해제
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        {/* A2A 검색(Discovery)을 위한 <link rel="agent"> 태그 추가 */}
        <link
          rel="agent"
          type="application/json"
          href="/.well-known/ai-agent.json"
          title="A2A Agent Builder"
        />
      </head>
      <body className={inter.className} suppressHydrationWarning={true}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}