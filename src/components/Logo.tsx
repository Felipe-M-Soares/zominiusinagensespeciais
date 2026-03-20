import logoLight from "@/assets/logo_concept_light.png";
import logoDark from "@/assets/logo_concept.png";

interface LogoProps {
  className?: string;
  alt?: string;
}

export function Logo({ className = "h-10 object-contain", alt = "Concept Usinagens Especiais" }: LogoProps) {
  return (
    <>
      <img src={logoLight} alt={alt} className={`${className} dark:hidden`} />
      <img src={logoDark} alt={alt} className={`${className} hidden dark:block`} />
    </>
  );
}
