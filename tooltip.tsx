export interface Device {
  udi_di: string;
  reference: string;
  model: string;
  brand_name: string;
  internal_code: string;
  anvisa_registration: string;
  manufacturer_country: string;
  classification_code: string;
  risk_class: string;
  sterile: boolean;
  single_use: boolean;
  implantable: boolean;
  intended_use: string;
  body_region: string;
  primary_material: string;
  secondary_material: string | null;
  surface_treatment: string | null;
  exocad_compatibility: string;
  compatible_systems: unknown;
  icon_url: string | null;
}

export interface DevicesData {
  devices: Device[];
}
