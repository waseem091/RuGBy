import numpy as np

def count_intermediate_hexcodes(initial_hex, final_hex):
    """Calculate number of hexcodes between two hex color codes (inclusive)"""
    try:
        # Strip '#' if present and convert to integers
        initial_int = int(initial_hex.strip('#'), 16)
        final_int = int(final_hex.strip('#'), 16)

        # Return count including both start and end values
        return abs(final_int - initial_int) + 1
    except ValueError:
        return "Error: Invalid hexcode format. Please use format 'RRGGBB' or '#RRGGBB'"

def main():
    while True:
        print("\nHexcode Count")
        print("Enter 'q' to quit")

        # Get input from user
        initial_hex = input("Initial Hexcode: ")
        if initial_hex.lower() == 'q':
            break

        final_hex = input("Final Hexcode: ")
        if final_hex.lower() == 'q':
            break

        # Calculate and display result
        result = count_intermediate_hexcodes(initial_hex, final_hex)
        print(f"\nNumber of hexcodes between {initial_hex} and {final_hex}: {result}")

if __name__ == "__main__":
    main()