import os
import sys
import qrcode

def generate_office_qr():
    # Read secret from environment or fallback to default
    secret = os.environ.get("OFFICE_ATTENDANCE_QR_SECRET", "MARKHINS_OFFICE_SECRET_KEY_2026").strip()
    qr_content = f"MARKHINS_OFFICE_ATTENDANCE:{secret}"

    print("==================================================")
    print("  MARKHINS OFFICE ATTENDANCE — PERMANENT QR SETUP  ")
    print("==================================================")
    print(f"[*] Secret Key: {secret[:4]}...{secret[-4:] if len(secret) > 8 else ''}")
    print(f"[*] QR Payload: {qr_content}")

    # Generate QR Code image
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H, # High error correction for printed display
        box_size=12,
        border=4,
    )
    qr.add_data(qr_content)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    output_filename = "office_qr_code.png"
    img.save(output_filename)

    abs_path = os.path.abspath(output_filename)
    print("\n[SUCCESS] Permanent Office QR Code generated successfully!")
    print(f"[FILE] Saved at: {abs_path}")
    print("\n[INSTRUCTIONS FOR ADMINISTRATION]:")
    print(" 1. Print 'office_qr_code.png' on paper or cardstock.")
    print(" 2. Place/mount the printed QR code permanently in the college office.")
    print(" 3. Teachers can scan this physical QR code anytime from the web app.")
    print(" 4. This QR code never changes unless you reconfigure OFFICE_ATTENDANCE_QR_SECRET.")
    print("==================================================\n")

if __name__ == "__main__":
    generate_office_qr()
