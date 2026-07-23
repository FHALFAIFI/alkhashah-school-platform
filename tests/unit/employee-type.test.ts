import { describe, it, expect } from "vitest";
import {
  EMPLOYEE_TYPES,
  categoryForEmployeeType,
  employeeTypeForCategory,
  employeeTypeOf,
  isEmployeeType,
} from "@/lib/employee-type";

describe("نوع الموظف (D-019)", () => {
  it("النوعان المعتمدان هما «معلم» و«موظف إداري» فقط", () => {
    expect([...EMPLOYEE_TYPES]).toEqual(["معلم", "موظف إداري"]);
    expect(isEmployeeType("معلم")).toBe(true);
    expect(isEmployeeType("موظف إداري")).toBe(true);
    // التصنيف المصدري ليس نوعاً معتمداً للعرض
    expect(isEmployeeType("موظف")).toBe(false);
  });

  it("يشتق النوع من التصنيف المصدري حين يكون العمود الجديد فارغاً — لا صف قائم يُستثنى", () => {
    expect(employeeTypeOf({ category: "معلم" })).toBe("معلم");
    expect(employeeTypeOf({ category: "موظف" })).toBe("موظف إداري");
    expect(employeeTypeOf({ category: "موظف", employeeType: null })).toBe("موظف إداري");
    expect(employeeTypeOf({ category: "معلم", employeeType: "" })).toBe("معلم");
  });

  it("العمود الجديد يسبق التصنيف المصدري حين يحمل قيمة صالحة", () => {
    expect(employeeTypeOf({ category: "موظف", employeeType: "معلم" })).toBe("معلم");
    expect(employeeTypeOf({ category: "معلم", employeeType: "موظف إداري" })).toBe("موظف إداري");
  });

  it("قيمة غير صالحة في العمود الجديد تسقط إلى الاشتقاق من التصنيف المصدري", () => {
    expect(employeeTypeOf({ category: "معلم", employeeType: "قيمة غريبة" })).toBe("معلم");
    expect(employeeTypeOf({ category: "موظف", employeeType: "قيمة غريبة" })).toBe("موظف إداري");
  });

  it("التحويل ذهاباً وإياباً يحفظ التصنيف المصدري كما هو — لا يُعاد كتابة بيانات فارس", () => {
    expect(categoryForEmployeeType("معلم")).toBe("معلم");
    expect(categoryForEmployeeType("موظف إداري")).toBe("موظف");
    expect(employeeTypeForCategory("معلم")).toBe("معلم");
    expect(employeeTypeForCategory("موظف")).toBe("موظف إداري");
    for (const t of EMPLOYEE_TYPES) {
      expect(employeeTypeForCategory(categoryForEmployeeType(t))).toBe(t);
    }
  });
});
