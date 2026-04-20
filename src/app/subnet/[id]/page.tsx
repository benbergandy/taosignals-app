import SubnetPage from "./SubnetPage";

export function generateStaticParams() {
  return Array.from({ length: 129 }, (_, i) => ({ id: String(i) }));
}

export default function Page() {
  return <SubnetPage />;
}
