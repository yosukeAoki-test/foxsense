export default function TokushohoPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow p-8">
        <h1 className="text-xl font-bold text-gray-800 mb-6 border-b pb-4">特定商取引法に基づく表記</h1>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            <Row label="販売業者">
              geoAlpine合同会社
            </Row>
            <Row label="代表者名">
              青木洋輔
            </Row>
            <Row label="所在地">
              山形県東根市温泉町1-20-1
            </Row>
            <Row label="電話番号">
              電話番号はメールにてお問い合わせいただいた場合、遅滞なく開示いたします。
            </Row>
            <Row label="メールアドレス">
              info@geoalpine.net
            </Row>
            <Row label="販売価格">
              各プランの購入画面に表示する金額（消費税込み）
            </Row>
            <Row label="代金の支払時期">
              クレジットカード決済：購入手続き完了時に即時決済
            </Row>
            <Row label="代金の支払方法">
              クレジットカード（Stripe 経由：Visa・Mastercard・American Express・JCB 等）
            </Row>
            <Row label="サービスの提供時期">
              決済完了後、FoxCoin を即時付与します。
            </Row>
            <Row label="返品・キャンセルについて">
              デジタルコンテンツの性質上、購入完了後の返金・キャンセルはお受けできません。<br />
              ただし、システム障害等による未付与が発生した場合は、個別に対応いたします。
            </Row>
            <Row label="動作環境">
              最新バージョンの Chrome・Firefox・Safari・Edge（インターネット接続必須）
            </Row>
          </tbody>
        </table>
        <p className="text-xs text-gray-400 mt-8 text-center">
          ご不明な点はメールにてお問い合わせください。
        </p>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <tr className="align-top">
      <td className="py-3 pr-4 font-medium text-gray-600 whitespace-nowrap w-40">{label}</td>
      <td className="py-3 text-gray-800 leading-relaxed">{children}</td>
    </tr>
  )
}
