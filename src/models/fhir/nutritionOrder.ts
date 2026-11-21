export interface Coding {
  system?: string;
  code: string;
  display?: string;
}

export interface CodeableConcept {
  coding: Coding[];
  text?: string;
}

export interface SimpleQuantity {
  value: number;
  unit: string;
  system?: string;
  code?: string;
}

export interface NutrientModifier {
  modifier: CodeableConcept;
  amount?: SimpleQuantity;
}

export interface TextureModifier {
  modifier?: CodeableConcept;
  foodType?: CodeableConcept;
}

export interface OralDiet {
  type: CodeableConcept[];
  nutrient: NutrientModifier[];
  texture: TextureModifier[];
  instruction?: string;
}

export interface EvidenceBasis {
  guideline_name: string;
  citation_url: string;
  pharmacology_source?: string;
  rationale: string;
}

export interface FHIRNutritionOrder {
  resourceType: "NutritionOrder";
  id?: string;
  status: "draft" | "active" | "on-hold" | "revoked" | "completed";
  intent: "proposal" | "plan" | "order";
  patient_id: string;
  dateTime: string;
  orderer?: string;
  oralDiet?: OralDiet;
  excludeFoodModifier: CodeableConcept[];
  evidence_basis: EvidenceBasis[];
}

