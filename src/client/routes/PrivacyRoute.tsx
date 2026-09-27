import React from "react";
import {
  LegalDocument,
  LegalList,
  LegalSection,
  OPERATOR_EMAIL,
  OPERATOR_NAME,
} from "#components/layout/LegalDocument";

/**
 * 개인정보 처리방침 (개인정보 보호법 제30조).
 *
 * 수집 항목은 `src/db/schema/auth.ts`와 `src/worker/lib/auth.ts`의 소셜 프로필
 * 매핑을 따른다. 저장하는 값이 바뀌면 이 글도 함께 고친다.
 */
export function PrivacyRoute(): React.JSX.Element {
  return (
    <LegalDocument title="개인정보 처리방침" effectiveDate="2026년 9월 27일">
      <p>
        방송팀(이하 &lsquo;서비스&rsquo;)은 「개인정보 보호법」에 따라 이용자의
        개인정보를 보호하고 관련 고충을 원활하게 처리하기 위해 다음과 같이
        개인정보 처리방침을 둡니다.
      </p>

      <LegalSection title="1. 처리하는 개인정보 항목과 수집 방법">
        <LegalList>
          <li>
            카카오·네이버·Google 로그인 시 해당 서비스에서 받는 정보: 이름 또는
            닉네임, 이메일 주소(제공되는 경우), 프로필 이미지, 소셜 계정 식별자
          </li>
          <li>
            로그인 유지에 필요한 정보: 로그인 토큰, 접속 IP 주소, 브라우저
            정보(User-Agent), 접속 일시
          </li>
          <li>
            이용자가 서비스에서 직접 만든 정보: 곡(가사·슬라이드), 세트, 폴더,
            신고 내용
          </li>
          <li>이용 동의 기록: 약관·개인정보 수집·이용에 동의한 시각</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="2. 처리 목적">
        <LegalList>
          <li>회원 식별과 로그인 유지</li>
          <li>만든 곡과 세트를 계정에 저장하고 여러 기기에서 동기화</li>
          <li>공유 라이브러리와 세트 링크 공유 기능 제공</li>
          <li>신고 처리와 부정 이용 방지</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="3. 다른 이용자에게 공개되는 정보">
        <p>
          곡을 공유 라이브러리에 공개하거나 세트 링크를 공유하면 이용자의 이름
          또는 닉네임이 작성자로 함께 표시됩니다. Google 로그인은 Google 계정에
          등록된 이름이 쓰입니다.
        </p>
      </LegalSection>

      <LegalSection title="4. 보유 기간과 파기">
        <LegalList>
          <li>
            회원 탈퇴를 요청할 때까지 보유하고, 요청을 받으면 지체 없이
            파기합니다.
          </li>
          <li>
            공유 라이브러리에서 다른 이용자가 이미 가져간 곡의 사본은 그
            이용자의 보관함에 남습니다.
          </li>
          <li>
            전자적 파일은 복구할 수 없는 방법으로 삭제합니다. 이용자의 기기에
            오프라인용으로 저장된 사본은 브라우저의 사이트 데이터 삭제로 지울 수
            있습니다.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="5. 제3자 제공과 국외 이전">
        <p>
          서비스는 개인정보를 제3자에게 제공하지 않습니다. 다만 서비스 운영을
          위해 다음과 같이 개인정보를 국외에 보관합니다(「개인정보 보호법」
          제28조의8 제1항 제3호).
        </p>
        <LegalList>
          <li>
            이전받는 자: Cloudflare, Inc. (privacyquestions@cloudflare.com)
          </li>
          <li>이전 국가: 미국 등 Cloudflare 데이터센터가 있는 국가</li>
          <li>이전 일시와 방법: 서비스를 이용할 때 네트워크를 통해 전송</li>
          <li>이전 항목: 1항의 모든 항목</li>
          <li>
            이전 목적: 서비스 호스팅과 데이터 저장(Workers, D1 데이터베이스, R2
            저장소)
          </li>
          <li>보유 기간: 4항과 같음</li>
          <li>
            국외 이전을 원하지 않으면 회원 탈퇴를 요청할 수 있습니다. 이 경우
            서비스를 이용할 수 없습니다.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="6. 쿠키와 기기 저장소">
        <p>
          로그인 유지에 필요한 쿠키만 사용하며 광고·분석용 쿠키는 쓰지 않습니다.
          오프라인에서도 쓸 수 있도록 곡과 세트를 브라우저 저장소(IndexedDB)에
          보관합니다. 브라우저 설정에서 쿠키를 막으면 로그인할 수 없습니다.
        </p>
      </LegalSection>

      <LegalSection title="7. 만 14세 미만 아동">
        <p>
          서비스는 만 14세 이상만 가입할 수 있습니다. 만 14세 미만의 가입 사실을
          알게 되면 해당 계정의 개인정보를 지체 없이 파기합니다.
        </p>
      </LegalSection>

      <LegalSection title="8. 이용자의 권리와 행사 방법">
        <p>
          이용자는 언제든지 개인정보의 열람·정정·삭제·처리정지와 회원 탈퇴를
          요청할 수 있습니다. 아래 개인정보 보호책임자에게 이메일로 요청하면
          본인 확인 후 지체 없이 처리합니다.
        </p>
      </LegalSection>

      <LegalSection title="9. 안전성 확보 조치">
        <LegalList>
          <li>모든 통신을 HTTPS로 암호화합니다.</li>
          <li>로그인 쿠키는 스크립트가 읽을 수 없게(httpOnly) 발급합니다.</li>
          <li>개인정보에 접근할 수 있는 사람을 운영자로 한정합니다.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="10. 개인정보 보호책임자">
        <LegalList>
          <li>성명: {OPERATOR_NAME}</li>
          <li>
            이메일: <a href={`mailto:${OPERATOR_EMAIL}`}>{OPERATOR_EMAIL}</a>
          </li>
        </LegalList>
        <p>개인정보 침해에 대한 신고나 상담은 아래 기관에도 할 수 있습니다.</p>
        <LegalList>
          <li>개인정보침해신고센터: privacy.kisa.or.kr, 국번 없이 118</li>
          <li>개인정보분쟁조정위원회: www.kopico.go.kr, 1833-6972</li>
          <li>대검찰청: www.spo.go.kr, 국번 없이 1301</li>
          <li>경찰청: ecrm.police.go.kr, 국번 없이 182</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="11. 처리방침 변경">
        <p>이 처리방침을 바꾸면 시행 7일 전부터 서비스 화면에 알립니다.</p>
      </LegalSection>
    </LegalDocument>
  );
}
