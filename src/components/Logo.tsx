import logoZomini from "@/assets/logo_zomini.png";

interface LogoProps {
  className?: string;
  alt?: string;
}

export function Logo({ className = "h-10 object-contain", alt = "Zomini Usinagens Especiais" }: LogoProps) {
  return (
    <img src={logoZomini} alt={alt} className={className} />
  );
}
