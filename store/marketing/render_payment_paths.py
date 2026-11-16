"""토스 심사용 결제경로 PPT 2종 생성 (경로 설명 + 화면 캡쳐)."""
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt

OUT_DIR = Path(__file__).resolve().parents[1]
SHOTS = Path(__file__).resolve().parent / "payment_path_shots"
LOGIN = "https://naver-smartstore-review-reply-production.up.railway.app/review-login.html"
BILLING = "https://naver-smartstore-review-reply-production.up.railway.app/billing.html"

SLIDE_W = 10.0
SLIDE_H = 7.5
MARGIN = 0.35


def add_title(slide, text, top=0.2):
    box = slide.shapes.add_textbox(Inches(MARGIN), Inches(top), Inches(SLIDE_W - MARGIN * 2), Inches(0.45))
    tf = box.text_frame
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(22)
    p.font.bold = True
    p.font.color.rgb = RGBColor(15, 23, 42)


def add_body(slide, lines, top=0.7, height=1.5):
    box = slide.shapes.add_textbox(Inches(MARGIN), Inches(top), Inches(SLIDE_W - MARGIN * 2), Inches(height))
    tf = box.text_frame
    tf.word_wrap = True
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = line
        p.font.size = Pt(13)
        p.font.color.rgb = RGBColor(51, 65, 85)
        p.space_after = Pt(3)


def add_shot(slide, name, top=2.2):
    """슬라이드 안에 들어가도록 가로·세로 모두 맞춤."""
    path = SHOTS / name
    if not path.exists():
        add_body(slide, [f"(캡쳐 없음: {name})"], top=top, height=0.5)
        return

    max_w = SLIDE_W - MARGIN * 2
    max_h = SLIDE_H - top - MARGIN
    # 캡쳐 비율 1280x800
    aspect = 1280 / 800
    width = max_w
    height = width / aspect
    if height > max_h:
        height = max_h
        width = height * aspect
    left = (SLIDE_W - width) / 2
    slide.shapes.add_picture(str(path), Inches(left), Inches(top), width=Inches(width), height=Inches(height))


def new_prs():
    prs = Presentation()
    prs.slide_width = Inches(SLIDE_W)
    prs.slide_height = Inches(SLIDE_H)
    return prs


def build_billing():
    prs = new_prs()

    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_title(s, "빌링(정기결제) 결제경로")
    add_body(
        s,
        [
            "서비스: 스마트스토어 AI 자동답글 (담도르즈)",
            "결제수단: 토스페이먼츠 빌링(카드 등록 · 자동결제)",
            "상품: 베이직 9,900원 / 스탠다드 19,900원 / 프로 39,900원 (각 30일)",
            f"로그인: {LOGIN}",
            f"결제 페이지: {BILLING}",
            "계정: toss-review-billing@damdores.com",
        ],
        top=0.75,
        height=2.0,
    )
    add_shot(s, "01-login.png", top=3.0)

    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_title(s, "1단계 · 심사 계정 로그인")
    add_body(
        s,
        [
            "1) review-login.html 접속",
            "2) toss-review-billing@damdores.com 로그인",
            "3) 결제 페이지로 이동 · 정기결제 안내 동의 체크",
        ],
        height=1.1,
    )
    add_shot(s, "01-login.png", top=2.0)

    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_title(s, "2단계 · 빌링 상품 3개 선택")
    add_body(
        s,
        [
            "「1. 빌링(정기결제) 상품 · 3개」에서 「빌링 결제창 열기」",
            "· 베이직 9,900원 · 스탠다드 19,900원 · 프로 39,900원",
        ],
        height=0.9,
    )
    add_shot(s, "08-billing-logged-in.png", top=1.8)

    for title, shot in [
        ("3단계 · 빌링 창 · 베이직 9,900원", "09a-billing-9900.png"),
        ("3단계 · 빌링 창 · 스탠다드 19,900원", "09b-billing-19900.png"),
        ("3단계 · 빌링 창 · 프로 39,900원", "09c-billing-39900.png"),
    ]:
        s = prs.slides.add_slide(prs.slide_layouts[6])
        add_title(s, title)
        add_body(
            s,
            [
                "토스페이먼츠 requestBillingAuth 카드 등록 창",
                "심사용으로 결제 완료 없이 창 확인만 하셔도 됩니다.",
            ],
            height=0.8,
        )
        add_shot(s, shot, top=1.7)

    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_title(s, "홈페이지 하단 정보 (사업자정보)")
    add_body(
        s,
        [
            "결제 페이지(billing.html) 하단",
            "상호 담도르즈 · 대표 김윤기 · 사업자등록번호 562-34-01671",
            "사업장 주소(동·호수) · 연락처 010-3909-7441",
        ],
        height=1.0,
    )
    add_shot(s, "07-footer.png", top=1.9)

    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_title(s, "환불 규정")
    add_body(
        s,
        [
            "URL: https://naver-smartstore-review-reply-production.up.railway.app/billing-terms.html",
            "결제 오류·중복 결제는 고객센터 문의 후 환불. 사용 기간 환불은 관리자 정책.",
        ],
        height=0.9,
    )
    add_shot(s, "02b-refund.png", top=1.8)

    out = OUT_DIR / "담도르즈_결제경로_빌링_정기결제.pptx"
    prs.save(out)
    return out


def build_onetime():
    prs = new_prs()

    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_title(s, "일반 결제(단건) 결제경로")
    add_body(
        s,
        [
            "서비스: 스마트스토어 AI 자동답글 (담도르즈)",
            "결제수단: 토스페이먼츠 일반 결제(단건)",
            "상품: 베이직 업그레이드 9,900 · 스탠다드 10,000 · 프로 30,000 · 스탠다드→프로 20,000",
            f"로그인: {LOGIN}",
            f"결제 페이지: {BILLING}",
            "계정: toss-review@damdores.com (베이직) 또는 심사용 빌링 계정으로 창 확인 가능",
        ],
        top=0.75,
        height=2.0,
    )
    add_shot(s, "01-login.png", top=3.0)

    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_title(s, "1단계 · 심사 계정 로그인")
    add_body(
        s,
        [
            "1) review-login.html 접속 후 로그인",
            "2) 결제 페이지 이동 · 정기결제 안내 동의",
        ],
        height=0.9,
    )
    add_shot(s, "01-login.png", top=1.8)

    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_title(s, "2단계 · 단건(업그레이드) 상품 4개")
    add_body(
        s,
        [
            "「2. 일반 결제(단건) 상품」에서 「단건 결제창 열기」",
            "· 9,900 / 10,000 / 30,000 / 20,000원",
        ],
        height=0.9,
    )
    add_shot(s, "10-onetime-logged-in.png", top=1.8)

    for title, shot in [
        ("3단계 · 단건 창 · 베이직 업그레이드 9,900원", "11a-onetime-9900.png"),
        ("3단계 · 단건 창 · 스탠다드 업그레이드 10,000원", "11b-onetime-10000.png"),
        ("3단계 · 단건 창 · 프로 업그레이드 30,000원", "11c-onetime-30000.png"),
        ("3단계 · 단건 창 · 스탠다드→프로 20,000원", "11d-onetime-20000.png"),
    ]:
        s = prs.slides.add_slide(prs.slide_layouts[6])
        add_title(s, title)
        add_body(
            s,
            [
                "토스페이먼츠 requestPayment 일반 카드 결제 창",
                "심사용으로 결제 완료 없이 창 확인만 하셔도 됩니다.",
            ],
            height=0.8,
        )
        add_shot(s, shot, top=1.7)

    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_title(s, "참고 · 단건 상품 4개 목록")
    add_shot(s, "06-onetime-products.png", top=0.85)

    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_title(s, "홈페이지 하단 정보 (사업자정보)")
    add_body(
        s,
        [
            "결제 페이지(billing.html) 하단",
            "상호 담도르즈 · 대표 김윤기 · 사업자등록번호 562-34-01671",
            "사업장 주소(동·호수) · 연락처 010-3909-7441",
        ],
        height=1.0,
    )
    add_shot(s, "07-footer.png", top=1.9)

    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_title(s, "환불 규정")
    add_body(
        s,
        [
            "URL: https://naver-smartstore-review-reply-production.up.railway.app/billing-terms.html",
            "결제 오류·중복 결제는 고객센터 문의 후 환불. 사용 기간 환불은 관리자 정책.",
        ],
        height=0.9,
    )
    add_shot(s, "02b-refund.png", top=1.8)

    out = OUT_DIR / "담도르즈_결제경로_단건결제.pptx"
    prs.save(out)
    return out


if __name__ == "__main__":
    a = build_billing()
    b = build_onetime()
    print(a)
    print(b)
