import React from "react";
import {
  LegalDocument,
  LegalList,
  LegalSection,
  OPERATOR_EMAIL,
  OPERATOR_NAME,
} from "#components/layout/LegalDocument";

/**
 * 이용약관.
 *
 * 공유 라이브러리 때문에 둔다. 공개한 곡을 다른 이용자가 가져가 쓰는 이용 허락과,
 * 권리자 요청 시 게시를 중단하는 절차(저작권법 제103조)를 여기서 정한다.
 */
export function TermsRoute(): React.JSX.Element {
  return (
    <LegalDocument title="이용약관" effectiveDate="2026년 9월 27일">
      <LegalSection title="제1조 (목적)">
        <p>
          이 약관은 {OPERATOR_NAME}(이하 &lsquo;운영자&rsquo;)가 제공하는
          방송팀(이하 &lsquo;서비스&rsquo;)의 이용 조건과 절차, 운영자와
          이용자의 권리·의무를 정합니다.
        </p>
      </LegalSection>

      <LegalSection title="제2조 (서비스 내용)">
        <p>
          서비스는 예배용 찬양 가사 슬라이드를 만들고, 세트로 묶어 송출하고,
          다른 이용자와 곡을 나누는 기능을 무료로 제공합니다.
        </p>
      </LegalSection>

      <LegalSection title="제3조 (계정)">
        <LegalList>
          <li>
            카카오·네이버·Google 계정으로 로그인하고 이 약관과 개인정보
            처리방침에 동의하면 가입됩니다.
          </li>
          <li>만 14세 이상만 가입할 수 있습니다.</li>
          <li>
            교회 공용 PC 등에서는 사용 후 로그아웃해 주세요. 계정 관리 소홀로
            생긴 문제는 이용자에게 책임이 있습니다.
          </li>
          <li>
            이용자는 언제든지 운영자에게 이메일로 회원 탈퇴를 요청할 수
            있습니다.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="제4조 (게시물과 저작권)">
        <LegalList>
          <li>
            이용자가 입력한 가사와 곡 정보의 저작권은 원저작자에게 있습니다.
            이용자는 소속 교회의 저작권 라이선스(예: CCLI) 등 정당한 권한 범위
            안에서 서비스를 이용해야 합니다.
          </li>
          <li>
            곡을 공유 라이브러리에 공개하면, 다른 이용자가 그 곡을 검색해 보고
            자기 보관함으로 가져가 고쳐 쓸 수 있도록 무상으로 허락하는 것으로
            봅니다.
          </li>
          <li>
            공개한 곡은 언제든 비공개로 돌릴 수 있습니다. 다만 다른 이용자가
            이미 가져간 사본은 남습니다.
          </li>
          <li>
            공개한 곡이 다른 사람의 권리를 침해해 생긴 책임은 그 곡을 공개한
            이용자에게 있습니다.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="제5조 (권리 침해 신고와 게시 중단)">
        <p>
          자신의 저작권 등 권리가 침해되었다고 생각하는 사람은 서비스의 신고
          기능이나 이메일(
          <a href={`mailto:${OPERATOR_EMAIL}`}>{OPERATOR_EMAIL}</a>)로 게시
          중단을 요청할 수 있습니다. 운영자는 요청을 받으면 지체 없이 해당 곡의
          공개를 중단합니다.
        </p>
      </LegalSection>

      <LegalSection title="제6조 (금지 행위와 이용 제한)">
        <p>이용자는 다음 행위를 해서는 안 됩니다.</p>
        <LegalList>
          <li>다른 사람의 저작권 등 권리를 침해하는 게시물 공개</li>
          <li>음란하거나 폭력적인 내용, 다른 사람을 비방하는 내용 공개</li>
          <li>다른 사람의 계정을 쓰거나 서비스 운영을 방해하는 행위</li>
        </LegalList>
        <p>
          운영자는 이를 위반한 게시물의 공개를 중단하거나 계정 이용을 제한할 수
          있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제7조 (서비스 변경과 중단)">
        <p>
          서비스는 개인이 무료로 운영합니다. 운영자는 기능을 바꾸거나 서비스를
          중단할 수 있고, 중단할 때는 30일 전에 서비스 화면에 알립니다. 중요한
          곡과 세트는 이용자가 따로 보관해 두기를 권합니다.
        </p>
      </LegalSection>

      <LegalSection title="제8조 (책임 제한)">
        <p>
          운영자는 무료로 제공하는 서비스의 이용과 관련해 이용자에게 생긴 손해에
          대해, 운영자의 고의 또는 중대한 과실이 없는 한 책임을 지지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="제9조 (약관 변경)">
        <p>
          약관을 바꾸면 시행 7일 전부터 서비스 화면에 알립니다. 이용자에게
          불리한 변경은 30일 전부터 알립니다. 바뀐 약관에 동의하지 않으면 회원
          탈퇴를 요청할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제10조 (준거법과 관할)">
        <p>
          이 약관은 대한민국 법에 따르며, 분쟁은 「민사소송법」에 따른 관할
          법원에서 해결합니다.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
